import { findByProps, find } from "@vendetta/metro";
import { before, instead } from "@vendetta/patcher";
import { showToast } from "@vendetta/ui/toasts";
import { getAssetIDByName } from "@vendetta/ui/assets";

// All findings below come from statically decompiling Discord's actual
// compiled Android bundle (Hermes bytecode), not from guessing — so the
// function/prop names here are the real, confirmed runtime names.

let addReactionUnpatch: (() => void) | null = null;
let dispatchUnpatch: (() => void) | null = null;

// Feature 1 (default to Super) + Feature 2 (double-tap = Super):
//
// The real action-creator signature is:
//   addReaction(channelId, messageId, emoji, location, options)
// where options is an object like { burst: boolean }.
//
// Every confirmed caller of this specific addReaction (onPressEmoji in the
// reaction picker, handleAddDefaultDoubleTapReaction for double-tap,
// AddReactionButton, handleAddOrRemoveReaction) is a "you are sending a
// reaction" context — never a "someone else's reaction arrived" context
// (those are handled by separately-named handleReaction/handleReactionBatch
// functions elsewhere, which this does not touch).
//
// This unconditionally forces every outgoing reaction to carry burst: true,
// regardless of what the caller passed. The full emoji picker's "Super"
// toggle defaults to off and explicitly passes burst: false until manually
// toggled — an earlier version of this patch respected that explicit
// false, which is exactly why the toggle still had to be tapped manually.
// Forcing it unconditionally makes every reaction path (picker taps,
// double-tap, quick-reaction bar) behave the same way with no toggling.
//
// TEMPORARY: logs a one-time-per-location diagnostic toast so we can see
// whether the full emoji picker's tap is actually reaching this patched
// function at all, or routes through a different module entirely. Remove
// once confirmed.
const seenLocations = new Set<string>();

const patchAddReaction = (): boolean => {
  try {
    const mod = findByProps("addReaction");
    if (!mod?.addReaction) return false;

    addReactionUnpatch = before("addReaction", mod, (args: any[]) => {
      try {
        const locationKey = String(args[3]);
        if (!seenLocations.has(locationKey)) {
          seenLocations.add(locationKey);
          showToast(`SuperReactionTweaks: addReaction fired, location=${locationKey}`, getAssetIDByName("ic_check"));
        }

        const existingOptions = args[4] && typeof args[4] === "object" ? args[4] : {};
        args[4] = { ...existingOptions, burst: true };
      } catch (e) {}
      return args;
    });

    return true;
  } catch (e) {
    return false;
  }
};

// Feature 3 (remove the full-screen animation):
//
// The animation is triggered by dispatching a Flux action of type
// "BURST_REACTION_EFFECT_PLAY" (this is the exact same action Vencord's
// desktop version patches to implement its own playing-limit feature).
// Rather than patching the standalone playBurstReaction function that
// creates this dispatch (fragile: if other code already captured a direct
// reference to that function via destructuring before this patch installs,
// patching the module property afterward would have no effect on those
// existing references), this patches Discord's central Flux dispatcher
// itself and swallows this specific action type before it reaches any
// listener — dispatch() is a single, stable, virtually always-current
// method call, not something callers typically hold a stale direct
// reference to.
const patchDispatch = (): boolean => {
  try {
    const mod = findByProps("dispatch", "subscribe");
    if (!mod?.dispatch) return false;

    dispatchUnpatch = before("dispatch", mod, (args: any[]) => {
      try {
        if (args[0]?.type === "BURST_REACTION_EFFECT_PLAY") {
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

export default {
  onLoad: () => {
    const addReactionOk = patchAddReaction();
    const dispatchOk = patchDispatch();

    if (!addReactionOk || !dispatchOk) {
      showToast(
        `SuperReactionTweaks: addReaction=${addReactionOk ? "ok" : "FAILED"}, dispatch-patch=${dispatchOk ? "ok" : "FAILED"}`,
        getAssetIDByName("ic_close_16px")
      );
    }
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
  }
};
