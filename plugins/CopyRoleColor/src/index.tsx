import { patcher } from "@vendetta";
import { findByName, findByDisplayName, findByTypeName } from "@vendetta/metro";
import { findInReactTree } from "@vendetta/utils";
import { getAssetIDByName } from "@vendetta/ui/assets";
import { clipboard } from "@vendetta/metro/common";
import { showToast } from "@vendetta/ui/toasts";

let unpatches: (() => void)[] = [];
const patched = new Set<any>();

const toHex = (value: unknown): string | null => {
    if (typeof value === "number" && Number.isFinite(value)) {
        return `#${(value & 0xffffff).toString(16).padStart(6, "0").toUpperCase()}`;
    }
    if (typeof value !== "string") return null;
    const s = value.trim();
    const m = s.match(/^#?([0-9a-f]{6})(?:[0-9a-f]{2})?$/i);
    return m ? `#${m[1].toUpperCase()}` : null;
};

const addValue = (out: string[], value: unknown) => {
    const hex = toHex(value);
    if (hex && !out.includes(hex)) out.push(hex);
};

const addGradient = (out: string[], value: unknown) => {
    if (typeof value !== "string") return;
    // CSS gradients can contain any number of hex stops. Keep their order.
    const matches = value.match(/#[0-9a-f]{6}(?:[0-9a-f]{2})?/gi) ?? [];
    for (const m of matches) addValue(out, m);
};

const inspectObject = (root: any, out: string[], depth = 0, seen = new Set<any>()) => {
    if (!root || depth > 5 || typeof root !== "object" || seen.has(root)) return;
    seen.add(root);

    const p = root.props ?? root;
    const role = p.role ?? p.roleData ?? p.guildRole ?? p.guild_role;
    const colors = p.colors ?? role?.colors ?? role?.color_data ?? role?.colorData;

    if (colors) {
        addValue(out, colors.primary_color);
        addValue(out, colors.secondary_color);
        addValue(out, colors.tertiary_color);
        addValue(out, colors.primaryColor);
        addValue(out, colors.secondaryColor);
        addValue(out, colors.tertiaryColor);
    }

    addValue(out, role?.color);
    addValue(out, role?.primary_color);
    addValue(out, role?.secondary_color);
    addValue(out, role?.tertiary_color);
    addValue(out, p.roleColor);
    addValue(out, p.color);
    addValue(out, p.backgroundColor);
    addValue(out, p.primaryColor);
    addValue(out, p.secondaryColor);
    addValue(out, p.tertiaryColor);

    addGradient(out, p.roleColor);
    addGradient(out, p.backgroundColor);
    addGradient(out, p.backgroundImage);
    addGradient(out, p.backgroundGradient);
    addGradient(out, p.gradient);

    const styles = Array.isArray(p.style) ? p.style : [p.style];
    for (const style of styles) {
        if (!style) continue;
        addValue(out, style.backgroundColor);
        addValue(out, style.color);
        addGradient(out, style.backgroundImage);
        addGradient(out, style.backgroundColor);
    }

    // Walk React children and props because Discord has moved the role object
    // around between several profile/role-pill implementations.
    if (p.children) {
        const children = Array.isArray(p.children) ? p.children : [p.children];
        for (const child of children) inspectObject(child, out, depth + 1, seen);
    }

    if (depth < 3) {
        for (const key of ["role", "roleData", "guildRole", "props", "children", "data"]) {
            if (p[key] && p[key] !== root) inspectObject(p[key], out, depth + 1, seen);
        }
    }
};

const getRoleColors = (args: any[], result: any): string[] => {
    const out: string[] = [];

    // First inspect the component's returned React tree and the arguments passed
    // into it. This works even when the exact internal prop location changes.
    inspectObject(result, out);
    for (const arg of args ?? []) inspectObject(arg, out);

    // Last-resort targeted React-tree searches for the shapes used by Discord.
    const nodes = [
        findInReactTree(result, (m: any) => !!m?.props?.role?.colors),
        findInReactTree(result, (m: any) => !!m?.props?.roleData?.colors),
        findInReactTree(result, (m: any) => m?.props?.roleColor != null),
    ];
    for (const node of nodes) inspectObject(node, out);

    return out;
};

const patchComponent = (component: any) => {
    if (!component || patched.has(component)) return;
    patched.add(component);

    try {
        unpatches.push(patcher.after("default", component, (args: any[], res: any) => {
            if (!res?.props) return;

            // Keep Discord's normal tap behavior. Only replace long-press.
            const originalLongPress = res.props.onLongPress;
            res.props.onLongPress = () => {
                const colors = getRoleColors(args, res);

                if (!colors.length) {
                    if (typeof originalLongPress === "function") originalLongPress();
                    else showToast("Could not find role color", getAssetIDByName("ic_message_copy"));
                    return;
                }

                clipboard.setString(colors.join(" "));
                showToast(
                    colors.length > 1
                        ? `Copied ${colors.length} role colors to clipboard`
                        : "Copied role color to clipboard",
                    getAssetIDByName("ic_message_copy"),
                );
            };
        }));
    } catch {
        // A stale module reference should not prevent the rest of the plugin loading.
    }
};

export default {
    onLoad: () => {
        // Discord has renamed/restructured this component over time. Try the
        // historical name plus the common role-pill variants and export forms.
        const finders = [
            () => findByName("ThemedRolePill", false),
            () => findByName("ThemedRolePill", true),
            () => findByDisplayName("ThemedRolePill", true),
            () => findByTypeName("ThemedRolePill", true),
            () => findByName("RolePill", false),
            () => findByName("RolePill", true),
            () => findByDisplayName("RolePill", true),
            () => findByTypeName("RolePill", true),
        ];

        for (const get of finders) {
            try { patchComponent(get()); } catch {}
        }
    },

    onUnload: () => {
        unpatches.forEach((unpatch) => unpatch());
        unpatches = [];
        patched.clear();
    },
};
