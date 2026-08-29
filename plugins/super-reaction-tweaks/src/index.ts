import { findByProps } from "@vendetta/metro";
import { before } from "@vendetta/patcher";
import { storage } from "@vendetta/plugin";
import { React } from "@vendetta/metro/common";
import { Forms } from "@vendetta/ui/components";

// All findings below come from statically decompiling Discord's actual
// compiled Android bundle (Hermes bytecode), not from guessing — so the
// function/prop names here are the real, confirmed runtime names.
//
// - addReaction(channelId, messageId, emoji, location, options) is the
//   shared action-creator behind every way you can send a reaction.
//   Confirmed `location` values: "Message" (manual picker taps and the
//   quick-reaction bar) and "Double Tap" (the double-tap gesture).
// - The full-screen "you just sent a Super Reaction" animation on mobile
//   is triggered by dispatching a Flux action of type
//   "BURST_REACTION_EFFECT_SEND" — a different, mobile-specific action
//   from "BURST_REACTION_EFFECT_PLAY" (which Vencord's desktop version
//   targets, and which is suppressed here too in case it's ever used).

interface Settings {
  defaultToSuper: boolean;
  doubleTapToSuper: boolean;
  removeAnimation: boolean;
}

const DEFAULT_SETTINGS: Settings = {
  defaultToSuper: true,
  doubleTapToSuper: true,
  removeAnimation: true
};

const getSettings = (): Settings => {
  return { ...DEFAULT_SETTINGS, ...storage };
};

let addReactionUnpatch: (() => void) | null = null;
let dispatchUnpatch: (() => void) | null = null;

const patchAddReaction = (): boolean => {
  try {
    const mod = findByProps("addReaction");
    if (!mod?.addReaction) return false;

    addReactionUnpatch = before("addReaction", mod, (args: any[]) => {
      try {
        const settings = getSettings();
        const isDoubleTap = args[3] === "Double Tap";
        const shouldForceBurst = isDoubleTap ? settings.doubleTapToSuper : settings.defaultToSuper;

        if (shouldForceBurst) {
          const existingOptions = args[4] && typeof args[4] === "object" ? args[4] : {};
          args[4] = { ...existingOptions, burst: true };
        }
      } catch (e) {}
      return args;
    });

    return true;
  } catch (e) {
    return false;
  }
};

const patchDispatch = (): boolean => {
  try {
    const mod = findByProps("dispatch", "subscribe");
    if (!mod?.dispatch) return false;

    dispatchUnpatch = before("dispatch", mod, (args: any[]) => {
      try {
        const settings = getSettings();
        const actionType = args[0]?.type;

        if (
          settings.removeAnimation &&
          (actionType === "BURST_REACTION_EFFECT_PLAY" || actionType === "BURST_REACTION_EFFECT_SEND")
        ) {
          args[0] = { ...args[0], type: "__SUPER_REACTION_TWEAKS_SUPPRESSED__" };
        }
      } catch (e) {}
      return args;
    });

    return true;
  } catch (e) {
    return false;
  }
};

const SettingsComponent = () => {
  const [settings, setSettings] = React.useState(getSettings());

  const updateSetting = (key: keyof Settings, value: boolean) => {
    const updated = { ...settings, [key]: value };
    Object.assign(storage, updated);
    setSettings(updated);
  };

  return React.createElement(
    Forms.FormSection,
    { title: "Super Reaction Tweaks" },
    React.createElement(Forms.FormSwitchRow, {
      label: "Super reactions by default",
      subLabel: "",
      value: settings.defaultToSuper,
      onValueChange: (value: boolean) => updateSetting("defaultToSuper", value)
    }),
    React.createElement(Forms.FormSwitchRow, {
      label: "Double-tap to super react",
      subLabel: "",
      value: settings.doubleTapToSuper,
      onValueChange: (value: boolean) => updateSetting("doubleTapToSuper", value)
    }),
    React.createElement(Forms.FormSwitchRow, {
      label: "Remove Super Reaction animation",
      subLabel: "",
      value: settings.removeAnimation,
      onValueChange: (value: boolean) => updateSetting("removeAnimation", value)
    })
  );
};

export default {
  onLoad: () => {
    patchAddReaction();
    patchDispatch();
  },

  onUnload: () => {
    if (addReactionUnpatch) {
      try {
        addReactionUnpatch();
      } catch (e) {}
      addReactionUnpatch = null;
    }
    if (dispatchUnpatch) {
      try {
        dispatchUnpatch();
      } catch (e) {}
      dispatchUnpatch = null;
    }
  },

  settings: SettingsComponent
};
