import { patcher } from "@vendetta";
import { findByName } from "@vendetta/metro";
import { findInReactTree } from "@vendetta/utils";
import { getAssetIDByName } from "@vendetta/ui/assets";
import { clipboard } from "@vendetta/metro/common";
import { showToast } from "@vendetta/ui/toasts";

let unpatches: (() => void)[] = [];

const toHex = (value: unknown): string | null => {
    if (typeof value === "number" && Number.isFinite(value)) {
        return `#${(value & 0xffffff).toString(16).padStart(6, "0").toUpperCase()}`;
    }

    if (typeof value !== "string") return null;

    const match = value.trim().match(/^#?([0-9a-f]{6}|[0-9a-f]{8})$/i);
    if (!match) return null;

    return `#${match[1].slice(0, 6).toUpperCase()}`;
};

const colorsFromGradient = (value: unknown): string[] => {
    if (typeof value !== "string") return [];

    // Handles strings such as linear-gradient(..., #RRGGBB, #RRGGBB)
    const matches = value.match(/#[0-9a-f]{6,8}\b/gi) ?? [];
    return matches.map((c) => `#${c.slice(1, 7).toUpperCase()}`);
};

const roleColors = (node: any): string[] => {
    const props = node?.props ?? {};
    const found: string[] = [];

    const add = (value: unknown) => {
        const hex = toHex(value);
        if (hex && !found.includes(hex)) found.push(hex);
    };

    const addGradient = (value: unknown) => {
        for (const hex of colorsFromGradient(value)) {
            if (!found.includes(hex)) found.push(hex);
        }
    };

    // Discord/Vendetta has used several different shapes for role colors.
    const role = props.role ?? props.roleData ?? props.guildRole;
    const colors = role?.colors ?? props.colors;

    if (colors) {
        add(colors.primary_color);
        add(colors.secondary_color);
        add(colors.tertiary_color);
        add(colors.primaryColor);
        add(colors.secondaryColor);
        add(colors.tertiaryColor);
    }

    add(role?.color);
    add(props.roleColor);
    add(props.color);
    add(props.backgroundColor);

    addGradient(props.roleColor);
    addGradient(props.backgroundColor);
    addGradient(props.style?.backgroundImage);
    addGradient(props.style?.[1]?.backgroundImage);
    addGradient(props.style?.[1]?.backgroundColor);

    // Some Discord builds expose the role object deeper in the rendered tree.
    const roleNode = findInReactTree(node, (m: any) => {
        const p = m?.props;
        return !!(p?.role?.colors || p?.roleData?.colors || p?.roleColor);
    });

    const rp = roleNode?.props;
    const rr = rp?.role ?? rp?.roleData;
    const rc = rr?.colors ?? rp?.colors;

    if (rc) {
        add(rc.primary_color);
        add(rc.secondary_color);
        add(rc.tertiary_color);
        add(rc.primaryColor);
        add(rc.secondaryColor);
        add(rc.tertiaryColor);
    }

    add(rr?.color);
    add(rp?.roleColor);
    addGradient(rp?.roleColor);

    return found;
};

export default {
    onLoad: () => {
        const ThemedRolePill = findByName("ThemedRolePill", false);
        if (!ThemedRolePill) return;

        unpatches.push(
            patcher.after("default", ThemedRolePill, (_args, res) => {
                if (!res?.props?.onPress) return;

                res.props.onLongPress = () => {
                    const colors = roleColors(res);

                    if (!colors.length) {
                        showToast("Could not find role color", getAssetIDByName("ic_message_copy"));
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
            }),
        );
    },

    onUnload: () => {
        unpatches.forEach((unpatch) => unpatch());
        unpatches = [];
    },
};
