import { findByProps } from "@vendetta/metro";
import { before, instead } from "@vendetta/patcher";

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
// Rather than separately reproducing the reaction picker's internal
// "default to Super" toggle state (which would mean simulating a UI press
// on an internal component we don't have a stable, low-risk hook into),
// this patches the single shared choke point both features actually route
// through: it forces every outgoing reaction to carry burst: true unless a
// caller explicitly opted out with burst: false. This covers manual picker
// taps and double-tap identically, with one simple, low-risk patch.
const patchAddReaction = (): boolean => {
  try {
    const mod = findByProps("addReaction");
    if (!mod?.addReaction) return false;

    addReactionUnpatch = before("addReaction", mod, (args: any[]) => {
      try {
        const existingOptions = args[4] && typeof args[4] === "object" ? args[4] : {};
        if (existingOptions.burst !== false) {
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
    if (!mod?.playBurstReaction) return false;

    playBurstReactionUnpatch = instead("playBurstReaction", mod, () => undefined);
    return true;
  } catch (e) {
    return false;
  }
};

export default {
  onLoad: () => {
    patchAddReaction();
    patchPlayBurstReaction();
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
