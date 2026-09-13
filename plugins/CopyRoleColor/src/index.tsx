import { patcher } from "@vendetta";
import { findByName } from "@vendetta/metro";
import { findInReactTree } from "@vendetta/utils";
import { getAssetIDByName } from "@vendetta/ui/assets";
import { clipboard } from "@vendetta/metro/common";
import { showToast } from "@vendetta/ui/toasts";

let unpatches = [];
let hasLoggedOnce = false;

// Safely stringify a React element tree without blowing up on circular refs
// or gigantic fiber internals.
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

export default {
    onLoad: () => {
        const RolePill = findByName("RolePill", false);

        if (!RolePill) {
            showToast(
                "CopyRoleColor(debug): RolePill component not found at all",
                getAssetIDByName("ic_warning")
            );
            console.log("[CopyRoleColor debug] findByName('RolePill', false) returned nothing");
            return;
        }

        console.log("[CopyRoleColor debug] RolePill component found:", RolePill);

        unpatches.push(patcher.after("default", RolePill, (args, res) => {
            // Log the very first render so we can see the raw shape once,
            // without spamming the console on every re-render.
            if (!hasLoggedOnce) {
                hasLoggedOnce = true;
                console.log("[CopyRoleColor debug] first render args:", safeSummarize(args));
                console.log("[CopyRoleColor debug] first render res:", safeSummarize(res));
                console.log("[CopyRoleColor debug] res.props keys:", res?.props ? Object.keys(res.props) : "no props");
            }

            if (!res?.props) return;

            const verifiedIcon = findInReactTree(res, m => m?.props?.roleColor);
            const roleIcon = findInReactTree(res, m =>
                m?.props?.style?.[0]?.borderRadius &&
                m?.props?.style?.[1]?.backgroundColor?.startsWith?.("#")
            );
            const color = roleIcon?.props?.style?.[1]?.backgroundColor ?? verifiedIcon?.props?.roleColor;

            // ALWAYS attach onLongPress (even if the old onPress-gating
            // condition would have skipped it) so we can test regardless
            // of whether that condition still holds in this Discord version.
            const previousOnLongPress = res.props.onLongPress;
            res.props.onLongPress = (...pressArgs) => {
                const hasOnPress = !!res.props.onPress;
                const summary = `onPress:${hasOnPress} verifiedIcon:${!!verifiedIcon} roleIcon:${!!roleIcon} color:${color ?? "none"}`;
                console.log("[CopyRoleColor debug] long press fired. props keys:", Object.keys(res.props));
                console.log("[CopyRoleColor debug] verifiedIcon:", safeSummarize(verifiedIcon));
                console.log("[CopyRoleColor debug] roleIcon:", safeSummarize(roleIcon));
                showToast(`CopyRoleColor debug: ${summary}`, getAssetIDByName("ic_warning"));

                if (color) {
                    clipboard.setString(color);
                    showToast("Copied role color to clipboard: " + color, getAssetIDByName("ic_message_copy"));
                }

                if (typeof previousOnLongPress === "function") {
                    previousOnLongPress(...pressArgs);
                }
            };
        }));
    },
    onUnload: () => {
        unpatches.forEach(u => u());
        unpatches = [];
        hasLoggedOnce = false;
    },
}
