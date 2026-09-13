import { patcher } from "@vendetta";
import { findByName } from "@vendetta/metro";
import { getAssetIDByName } from "@vendetta/ui/assets";
import { clipboard } from "@vendetta/metro/common";
import { showToast } from "@vendetta/ui/toasts";

let unpatches = [];
let loggedSample = false;
let loggedPress = false;

function safeSummarize(obj, depth = 0) {
    if (obj === null || obj === undefined) return String(obj);
    if (depth > 4) return "…";
    if (typeof obj === "function") return `[Function: ${obj.name || "anonymous"}]`;
    if (typeof obj !== "object") return typeof obj === "string" ? `"${obj}"` : String(obj);
    if (Array.isArray(obj)) {
        return "[" + obj.slice(0, 8).map(v => safeSummarize(v, depth + 1)).join(", ") + (obj.length > 8 ? ", …" : "") + "]";
    }
    const keys = Object.keys(obj).slice(0, 30);
    return "{" + keys.map(k => {
        let v;
        try { v = obj[k]; } catch (e) { v = "<getter threw>"; }
        return `${k}: ${safeSummarize(v, depth + 1)}`;
    }).join(", ") + "}";
}

function walkElements(node, visit, depth = 0) {
    if (!node || depth > 12) return;
    if (Array.isArray(node)) {
        for (const child of node) walkElements(child, visit, depth + 1);
        return;
    }
    if (typeof node !== "object") return;
    if (node.$$typeof) visit(node);
    const children = node.props?.children;
    if (children) walkElements(children, visit, depth + 1);
}

function typeName(t) {
    if (typeof t === "function") return t.name || "anon fn";
    if (t && typeof t === "object" && t.displayName) return t.displayName;
    return String(t);
}

function instrumentRoleItemElement(el) {
    if (!el?.props || el.props.__copyRoleColorInstrumented) return;
    el.props.__copyRoleColorInstrumented = true;

    const previous = el.props.onLongPress;
    el.props.onLongPress = (...pressArgs) => {
        if (!loggedPress) {
            loggedPress = true;
            console.log("[CopyRoleColor debug v6] LONG PRESS - RoleItem element props:", safeSummarize(el.props));
        }

        const role = el.props.role ?? el.props.item ?? el.props.data ?? el.props.guildRole;
        let color = el.props.color ?? el.props.roleColor ?? role?.color;

        showToast(`RoleItem props: ${Object.keys(el.props).join(",")} | color=${color ?? "none"}`, getAssetIDByName("ic_warning"));

        if (color != null) {
            const hex = typeof color === "number"
                ? "#" + color.toString(16).padStart(6, "0")
                : color;
            clipboard.setString(hex);
            showToast("Copied role color: " + hex, getAssetIDByName("ic_message_copy"));
        }

        if (typeof previous === "function") previous(...pressArgs);
    };
}

export default {
    onLoad: () => {
        const mod = findByName("UserProfileRolesCard", false);
        if (!mod?.default) {
            showToast("CopyRoleColor(debug): module missing", getAssetIDByName("ic_warning"));
            return;
        }

        unpatches.push(patcher.after("default", mod, (args, res) => {
            walkElements(res, (el) => {
                if (typeName(el.type) !== "RolesList") return;
                if (el.type.__copyRoleColorWrapped) return;

                const OriginalRolesList = el.type;

                function PatchedRolesList(props) {
                    const innerResult = OriginalRolesList(props);

                    const roleItems = [];
                    walkElements(innerResult, (child) => {
                        if (typeName(child.type) === "RoleItem") roleItems.push(child);
                    });

                    if (!loggedSample && roleItems.length > 0) {
                        loggedSample = true;
                        console.log("[CopyRoleColor debug v6] RoleItem count:", roleItems.length);
                        console.log("[CopyRoleColor debug v6] sample RoleItem element:", safeSummarize(roleItems[0]));
                        console.log("[CopyRoleColor debug v6] sample RoleItem props keys:", Object.keys(roleItems[0].props || {}));
                    }

                    for (const item of roleItems) instrumentRoleItemElement(item);

                    return innerResult;
                }
                PatchedRolesList.__copyRoleColorWrapped = true;

                el.type = PatchedRolesList;
            });
        }));
    },
    onUnload: () => {
        unpatches.forEach(u => u());
        unpatches = [];
        loggedSample = false;
        loggedPress = false;
    },
}
