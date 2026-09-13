import { patcher } from "@vendetta";
import { findByName } from "@vendetta/metro";
import { findInReactTree } from "@vendetta/utils";
import { getAssetIDByName } from "@vendetta/ui/assets";
import { clipboard } from "@vendetta/metro/common";
import { showToast } from "@vendetta/ui/toasts";

let unpatches = [];
let logged = false;

function safeSummarize(obj, depth = 0) {
    if (obj === null || obj === undefined) return String(obj);
    if (depth > 2) return "…";
    if (typeof obj !== "object") return typeof obj === "string" ? `"${obj}"` : String(obj);
    if (Array.isArray(obj)) {
        return "[" + obj.slice(0, 6).map(v => safeSummarize(v, depth + 1)).join(", ") + (obj.length > 6 ? ", …" : "") + "]";
    }
    const keys = Object.keys(obj).slice(0, 25);
    return "{" + keys.map(k => {
        let v;
        try { v = obj[k]; } catch (e) { v = "<getter threw>"; }
        return `${k}: ${safeSummarize(v, depth + 1)}`;
    }).join(", ") + "}";
}

export default {
    onLoad: () => {
        const mod = findByName("UserProfileRolesCard", false);
        if (!mod) {
            showToast("CopyRoleColor(debug): UserProfileRolesCard not found", getAssetIDByName("ic_warning"));
            console.log("[CopyRoleColor debug v3] UserProfileRolesCard module not found");
            return;
        }
        if (!mod.RoleItem) {
            showToast("CopyRoleColor(debug): RoleItem export missing", getAssetIDByName("ic_warning"));
            console.log("[CopyRoleColor debug v3] module found but no RoleItem export:", Object.keys(mod));
            return;
        }

        console.log("[CopyRoleColor debug v3] patching RoleItem");

        unpatches.push(patcher.after("RoleItem", mod, (args, res) => {
            if (!logged) {
                logged = true;
                console.log("[CopyRoleColor debug v3] RoleItem FIRST RENDER args:", safeSummarize(args));
                console.log("[CopyRoleColor debug v3] RoleItem FIRST RENDER res:", safeSummarize(res));
            }

            if (!res?.props) return;

            const previous = res.props.onLongPress;
            res.props.onLongPress = (...pressArgs) => {
                console.log("[CopyRoleColor debug v3] LONG PRESS on RoleItem, props keys:", Object.keys(res.props));
                console.log("[CopyRoleColor debug v3] RoleItem args at press time:", safeSummarize(args));

                const verifiedIcon = findInReactTree(res, m => m?.props?.roleColor);
                const roleIcon = findInReactTree(res, m =>
                    m?.props?.style?.[0]?.borderRadius &&
                    m?.props?.style?.[1]?.backgroundColor?.startsWith?.("#")
                );
                // Also check args[0] directly, since RoleItem is likely called
                // with a `role` object prop containing color info.
                const argColor = args?.[0]?.role?.color ?? args?.[0]?.color;
                const color = roleIcon?.props?.style?.[1]?.backgroundColor
                    ?? verifiedIcon?.props?.roleColor
                    ?? argColor;

                showToast(`RoleItem color=${color ?? "none"}`, getAssetIDByName("ic_warning"));

                if (color) {
                    const hex = typeof color === "number"
                        ? "#" + color.toString(16).padStart(6, "0")
                        : color;
                    clipboard.setString(hex);
                    showToast("Copied role color: " + hex, getAssetIDByName("ic_message_copy"));
                }

                if (typeof previous === "function") previous(...pressArgs);
            };
        }));
    },
    onUnload: () => {
        unpatches.forEach(u => u());
        unpatches = [];
        logged = false;
    },
}
