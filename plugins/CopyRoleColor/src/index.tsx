import { patcher } from "@vendetta";
import { findByName } from "@vendetta/metro";
import { getAssetIDByName } from "@vendetta/ui/assets";
import { clipboard } from "@vendetta/metro/common";
import { showToast } from "@vendetta/ui/toasts";

let unpatches = [];
let loggedShape = false;
let loggedFirstItem = false;

function safeSummarize(obj, depth = 0) {
    if (obj === null || obj === undefined) return String(obj);
    if (depth > 3) return "…";
    if (typeof obj === "function") return `[Function: ${obj.name || "anonymous"}]`;
    if (typeof obj !== "object") return typeof obj === "string" ? `"${obj}"` : String(obj);
    if (Array.isArray(obj)) {
        return "[" + obj.slice(0, 8).map(v => safeSummarize(v, depth + 1)).join(", ") + (obj.length > 8 ? ", …" : "") + "]";
    }
    const keys = Object.keys(obj).slice(0, 25);
    return "{" + keys.map(k => {
        let v;
        try { v = obj[k]; } catch (e) { v = "<getter threw>"; }
        return `${k}: ${safeSummarize(v, depth + 1)}`;
    }).join(", ") + "}";
}

// Walk a React element tree (works for element objects and arrays of them)
// and call `visit` on every element node found, recursing into
// props.children at every level.
function walkElements(node, visit, depth = 0) {
    if (!node || depth > 12) return;
    if (Array.isArray(node)) {
        for (const child of node) walkElements(child, visit, depth + 1);
        return;
    }
    if (typeof node !== "object") return;
    if (node.$$typeof) {
        visit(node);
    }
    const children = node.props?.children;
    if (children) walkElements(children, visit, depth + 1);
}

export default {
    onLoad: () => {
        const mod = findByName("UserProfileRolesCard", false);
        if (!mod?.RoleItem || !mod?.default) {
            showToast("CopyRoleColor(debug): module/exports missing", getAssetIDByName("ic_warning"));
            console.log("[CopyRoleColor debug v4] module shape:", mod ? Object.keys(mod) : "not found");
            return;
        }

        const RoleItemRef = mod.RoleItem;
        console.log("[CopyRoleColor debug v4] watching for elements with type === RoleItem reference");

        unpatches.push(patcher.after("default", mod, (args, res) => {
            const matches = [];
            walkElements(res, (el) => {
                if (el.type === RoleItemRef) matches.push(el);
            });

            if (!loggedShape) {
                loggedShape = true;
                console.log("[CopyRoleColor debug v4] matched RoleItem elements count:", matches.length);
                if (matches.length > 0) {
                    console.log("[CopyRoleColor debug v4] sample RoleItem element:", safeSummarize(matches[0]));
                    console.log("[CopyRoleColor debug v4] sample RoleItem element props keys:", Object.keys(matches[0].props || {}));
                } else {
                    // Fall back: dump everything we found in the tree so we
                    // can see what types ARE present, in case RoleItem isn't
                    // used here at all despite being exported.
                    const allTypes = [];
                    walkElements(res, (el) => {
                        allTypes.push(typeof el.type === "function" ? (el.type.name || "anon fn") : el.type);
                    });
                    console.log("[CopyRoleColor debug v4] no RoleItem matches. All element types in tree:", safeSummarize(allTypes));
                }
            }

            for (const el of matches) {
                if (!el.props) continue;
                const previous = el.props.onLongPress;
                el.props.onLongPress = (...pressArgs) => {
                    if (!loggedFirstItem) {
                        loggedFirstItem = true;
                        console.log("[CopyRoleColor debug v4] LONG PRESS - element props:", safeSummarize(el.props));
                    }

                    const role = el.props.role ?? el.props.item ?? el.props.data;
                    let color = el.props.color ?? el.props.roleColor ?? role?.color;

                    showToast(`RoleItem props: ${Object.keys(el.props).join(",")} color=${color ?? "none"}`, getAssetIDByName("ic_warning"));

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
        }));
    },
    onUnload: () => {
        unpatches.forEach(u => u());
        unpatches = [];
        loggedShape = false;
        loggedFirstItem = false;
    },
}
