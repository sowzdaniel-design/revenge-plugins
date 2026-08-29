import { findByProps, find } from "@vendetta/metro";
import { before, instead } from "@vendetta/patcher";
import { showToast } from "@vendetta/ui/toasts";
import { getAssetIDByName } from "@vendetta/ui/assets";

// All findings below come from statically decompiling Discord's actual
// compiled Android bundle (Hermes bytecode), not from guessing — so the
// function/prop names here are the real, confirmed runtime names.

let addReactionUnpatch: (() => void) | null = null;
let playBurstReactionUnpatch: (() => void) | null = null;

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
const patchAddReaction = (): boolean => {
  try {
    const mod = findByProps("addReaction");
    if (!mod?.addReaction) return false;

    addReactionUnpatch = before("addReaction", mod, (args: any[]) => {
      try {
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
// playBurstReaction's entire job is dispatching the Flux action that
// triggers the full-screen Super Reaction animation:
//   dispatch({ type: "BURST_REACTION_EFFECT_PLAY", channelId, messageId, emoji, key })
// (this is the exact same action Vencord's desktop version patches to
// implement its own playing-limit feature). Replacing the whole function
// with a no-op skips the dispatch entirely, so the animation never fires,
// while everything else about sending/receiving the reaction is untouched.
const patchPlayBurstReaction = (): boolean => {
  try {
    const mod = findByProps("playBurstReaction");
    if (mod?.playBurstReaction) {
      playBurstReactionUnpatch = instead("playBurstReaction", mod, () => undefined);
      return true;
    }

    // Fallback: search every loaded module for a function that dispatches
    // the BURST_REACTION_EFFECT_PLAY action, in case the direct property
    // name lookup missed (e.g. different export name on this build).
    const bySource = find((m: any) => {
      try {
        for (const key of Object.keys(m || {})) {
          const val = m[key];
          if (typeof val === "function" && val.toString().includes("BURST_REACTION_EFFECT_PLAY")) {
            return true;
          }
        }
        return false;
      } catch (e) {
        return false;
      }
    });

    if (bySource) {
      const matchKey = Object.keys(bySource).find((key) => {
        try {
          return typeof bySource[key] === "function" && bySource[key].toString().includes("BURST_REACTION_EFFECT_PLAY");
        } catch (e) {
          return false;
        }
      });
      if (matchKey) {
        playBurstReactionUnpatch = instead(matchKey, bySource, () => undefined);
        return true;
      }
    }

    return false;
  } catch (e) {
    return false;
  }
};

export default {
  onLoad: () => {
    const addReactionOk = patchAddReaction();
    const playBurstOk = patchPlayBurstReaction();

    if (!addReactionOk || !playBurstOk) {
      showToast(
        `SuperReactionTweaks: addReaction=${addReactionOk ? "ok" : "FAILED"}, animation-block=${playBurstOk ? "ok" : "FAILED"}`,
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
    if (playBurstReactionUnpatch) {
      try {
        playBurstReactionUnpatch();
      } catch (e) {}
      playBurstReactionUnpatch = null;
    }
  }
};
