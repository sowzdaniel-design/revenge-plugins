import { patcher } from "@vendetta";
import { findByName } from "@vendetta/metro";
import { findInReactTree } from "@vendetta/utils";
import { getAssetIDByName } from "@vendetta/ui/assets";
import { clipboard } from "@vendetta/metro/common";
import { showToast } from "@vendetta/ui/toasts";

let unpatches = [];
const loggedOnce = {};

function safeSummarize(obj, depth = 0) {
    if (obj === null || obj === undefined) return String(obj);
    if (depth > 2) return "…";
    if (typeof obj !== "object") return typeof obj === "string" ? `"${obj}"` : String(obj);
    if (Array.isArray(obj)) {
        return "[" + obj.slice(0, 6).map(v => safeSummarize(v, depth + 1)).join(", ") + (obj.length > 6 ? ", …" : "") + "]";
    }
    const keys = Object.keys(obj).slice(0, 20);
    return "{" + keys.map(k => {
        let v;
        try { v = obj[k]; } catch (e) { v = "<getter threw>"; }
        return `${k}: ${safeSummarize(v, depth + 1)}`;
    }).join(", ") + "}";
}

// Candidates that might be responsible for rendering the role chips
// on the member profile "Roles" card.
const CANDIDATES = ["RolePill", "RoleDot", "RoleLabel", "UserProfileRolesCard"];

export default {
    onLoad: () => {
        console.log("[CopyRoleColor debug v2] onLoad start, watching:", CANDIDATES.join(", "));

        for (const name of CANDIDATES) {
            const mod = findByName(name, false);
            if (!mod) {
                console.log(`[CopyRoleColor debug v2] ${name}: NOT FOUND`);
                continue;
            }
            console.log(`[CopyRoleColor debug v2] ${name}: found`, safeSummarize(mod));

            unpatches.push(patcher.after("default", mod, (args, res) => {
                if (!loggedOnce[name]) {
                    loggedOnce[name] = true;
                    console.log(`[CopyRoleColor debug v2] ${name} FIRST RENDER args:`, safeSummarize(args));
                    console.log(`[CopyRoleColor debug v2] ${name} FIRST RENDER res:`, safeSummarize(res));
                }

                if (!res?.props) return;

                // Try to attach a long-press wherever a press handler already exists,
                // so we can see which component actually receives the gesture on
                // the screen you're testing.
                if (res.props.onPress || res.props.onLongPress) {
                    const previous = res.props.onLongPress;
                    res.props.onLongPress = (...pressArgs) => {
                        console.log(`[CopyRoleColor debug v2] LONG PRESS fired on ${name}`);
                        console.log(`[CopyRoleColor debug v2] ${name} props keys:`, Object.keys(res.props));

                        const verifiedIcon = findInReactTree(res, m => m?.props?.roleColor);
                        const roleIcon = findInReactTree(res, m =>
                            m?.props?.style?.[0]?.borderRadius &&
                            m?.props?.style?.[1]?.backgroundColor?.startsWith?.("#")
                        );
                        const color = roleIcon?.props?.style?.[1]?.backgroundColor ?? verifiedIcon?.props?.roleColor;

                        showToast(`${name}: color=${color ?? "none"}`, getAssetIDByName("ic_warning"));

                        if (color) {
                            clipboard.setString(color);
                            showToast("Copied role color: " + color, getAssetIDByName("ic_message_copy"));
                        }

                        if (typeof previous === "function") previous(...pressArgs);
                    };
                }
            }));
        }

        console.log("[CopyRoleColor debug v2] onLoad done, patches attached:", unpatches.length);
    },
    onUnload: () => {
        unpatches.forEach(u => u());
        unpatches = [];
        for (const k of Object.keys(loggedOnce)) delete loggedOnce[k];
    },
}
