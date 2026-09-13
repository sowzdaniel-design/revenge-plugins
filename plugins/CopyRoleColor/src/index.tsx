import { patcher } from "@vendetta";
import { findByName } from "@vendetta/metro";
import { findInReactTree } from "@vendetta/utils";
import { getAssetIDByName } from "@vendetta/ui/assets";
import { clipboard } from "@vendetta/metro/common";
import { showToast } from "@vendetta/ui/toasts";

let unpatches = [];

export default {
    onLoad: () => {
        // Discord renamed this component from "ThemedRolePill" to "RolePill".
        // Guard against it being missing/renamed again so we fail safely
        // instead of throwing during onLoad (which prevents the plugin
        // from being enabled at all).
        const RolePill = findByName("RolePill", false);

        if (!RolePill) {
            showToast(
                "CopyRoleColor: couldn't find the role pill component, plugin disabled",
                getAssetIDByName("ic_warning")
            );
            return;
        }

        unpatches.push(patcher.after("default", RolePill, (args, res) => {
            if (!res?.props) return;

            if (res.props?.onPress) {
                let verifiedIcon = findInReactTree(res, m => m?.props?.roleColor);
                let roleIcon = findInReactTree(res, m =>
                    m?.props?.style?.[0]?.borderRadius &&
                    m?.props?.style?.[1]?.backgroundColor?.startsWith?.("#")
                );
                const color = roleIcon?.props?.style?.[1]?.backgroundColor ?? verifiedIcon?.props?.roleColor;

                if (!color) return;

                res.props.onLongPress = () => {
                    clipboard.setString(color);
                    showToast("Copied role color to clipboard", getAssetIDByName("ic_message_copy"));
                };
            }
        }));
    },
    onUnload: () => {
        unpatches.forEach(u => u());
        unpatches = [];
    },
}
