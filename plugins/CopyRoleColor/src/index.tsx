import { patcher } from "@vendetta";
import { findByName } from "@vendetta/metro";
import { getAssetIDByName } from "@vendetta/ui/assets";
import { clipboard } from "@vendetta/metro/common";
import { showToast } from "@vendetta/ui/toasts";

let unpatches = [];
let loggedOuter = false;
let loggedInner = false;
let loggedPress = false;

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

// Attach onLongPress + color-copy logic to a single chip-like element.
function instrumentChipElement(el) {
    if (!el?.props) return;
    if (el.props.__copyRoleColorInstrumented) return;
    el.props.__copyRoleColorInstrumented = true;

    const previous = el.props.onLongPress;
    el.props.onLongPress = (...pressArgs) => {
        if (!loggedPress) {
            loggedPress = true;
            console.log("[CopyRoleColor debug v5] LONG PRESS - chip element props:", safeSummarize(el.props));
        }

        const role = el.props.role ?? el.props.item ?? el.props.data;
        let color = el.props.color ?? el.props.roleColor ?? role?.color;

        showToast(`chip props: ${Object.keys(el.props).join(",")} color=${color ?? "none"}`, getAssetIDByName("ic_warning"));

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
                if (typeof el.type !== "function") return;
                if (el.type.name !== "RolesList") return;
                if (el.type.__copyRoleColorWrapped) return; // already wrapped this render's element

                const OriginalRolesList = el.type;

                function PatchedRolesList(props) {
                    const innerResult = OriginalRolesList(props);

                    if (!loggedOuter) {
                        loggedOuter = true;
                        console.log("[CopyRoleColor debug v5] RolesList props:", safeSummarize(props));
                        console.log("[CopyRoleColor debug v5] RolesList return value:", safeSummarize(innerResult));
                    }

                    const chipMatches = [];
                    walkElements(innerResult, (child) => {
                        // Anything with a press handler is a strong candidate
                        // for "the actual pressable chip".
                        if (child.props?.onPress || child.props?.onLongPress) {
                            chipMatches.push(child);
                        }
                    });

                    if (!loggedInner) {
                        loggedInner = true;
                        console.log("[CopyRoleColor debug v5] pressable chip candidates found:", chipMatches.length);
                        if (chipMatches.length > 0) {
                            console.log("[CopyRoleColor debug v5] sample chip element:", safeSummarize(chipMatches[0]));
                        } else {
                            const allTypes = [];
                            walkElements(innerResult, (child) => {
                                allTypes.push(typeof child.type === "function" ? (child.type.name || "anon fn") : child.type);
                            });
                            console.log("[CopyRoleColor debug v5] no pressable matches. types found:", safeSummarize(allTypes));
                        }
                    }

                    for (const chip of chipMatches) instrumentChipElement(chip);

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
        loggedOuter = false;
        loggedInner = false;
        loggedPress = false;
    },
}
