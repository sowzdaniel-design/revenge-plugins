import { findByName, findByProps } from "@vendetta/metro";
import { after } from "@vendetta/patcher";
import { storage } from "@vendetta/plugin";
import { React, ReactNative as RN } from "@vendetta/metro/common";
import { Forms } from "@vendetta/ui/components";
import { showToast } from "@vendetta/ui/toasts";
import { getAssetIDByName } from "@vendetta/ui/assets";

// Findings below come from statically decompiling Discord's actual
// compiled Android bundle (Hermes bytecode), not from guessing.
//
// - The profile avatar and banner components (UserProfileAvatar,
//   UserProfileBanner — both under modules/user_profile/native/ and
//   modules/*/native/ respectively) currently have no "view full size" tap
//   behavior in the general case (the banner only has an onPress at all
//   when it's an animated GIF, and that just toggles autoplay).
// - Rather than guessing which prop name each component uses internally
//   for its image URL, this walks the component's own *rendered* output
//   to find the actual <Image>-like element and reads its resolved
//   source.uri directly — correct regardless of internal prop plumbing.
// - Download uses Discord's own existing native bridge call,
//   MediaManager.downloadMediaAssetWithContentType(url, filename,
//   contentType), the same mechanism already used for saving message
//   image attachments — no custom file-handling needed.

interface Settings {
  downloadEnabled: boolean;
}

const DEFAULT_SETTINGS: Settings = {
  downloadEnabled: true
};

const getSettings = (): Settings => {
  return { ...DEFAULT_SETTINGS, ...storage };
};

let avatarUnpatch: (() => void) | null = null;
let bannerUnpatch: (() => void) | null = null;

// --- Finding the rendered image URL -----------------------------------

const MAX_TREE_DEPTH = 8;

// Walks a rendered React element tree looking for the first element whose
// props include an image-like `source` (an object with a `uri` string —
// the standard React Native Image source shape) or a plain string `src`.
// Returns the resolved URL string, or null if nothing matched.
const findImageUrlInTree = (node: any, depth: number = 0): string | null => {
  if (!node || depth > MAX_TREE_DEPTH) return null;

  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findImageUrlInTree(child, depth + 1);
      if (found) return found;
    }
    return null;
  }

  if (typeof node !== "object") return null;

  const props = node.props;
  if (props) {
    if (typeof props.src === "string" && props.src.startsWith("http")) {
      return props.src;
    }
    if (props.source && typeof props.source === "object" && typeof props.source.uri === "string") {
      return props.source.uri;
    }
    if (props.children) {
      const found = findImageUrlInTree(props.children, depth + 1);
      if (found) return found;
    }
  }

  return null;
};

// --- Download ------------------------------------------------------------

const getMediaManager = (): any => {
  try {
    const mod = findByProps("MediaManager");
    if (mod?.MediaManager) return mod.MediaManager;
  } catch (e) {}

  try {
    if (RN?.NativeModules?.MediaManager) return RN.NativeModules.MediaManager;
  } catch (e) {}

  return null;
};

const downloadImageUrl = (url: string, filename: string) => {
  try {
    const MediaManager = getMediaManager();
    if (!MediaManager) {
      showToast("Couldn't find the download function on this build", getAssetIDByName("ic_close_16px"));
      return;
    }

    const promise =
      MediaManager.downloadMediaAssetWithContentType
        ? MediaManager.downloadMediaAssetWithContentType(url, filename, null)
        : MediaManager.downloadMediaAsset(url, filename);

    if (promise?.then) {
      promise.then(
        () => showToast("Saved image", getAssetIDByName("ic_check")),
        () => showToast("Failed to save image", getAssetIDByName("ic_close_16px"))
      );
    }
  } catch (e) {
    showToast("Failed to save image", getAssetIDByName("ic_close_16px"));
  }
};

// --- Custom windowed viewer -----------------------------------------------

let closeViewer: (() => void) | null = null;

const ImageViewerModal = ({ url, onClose }: { url: string; onClose: () => void }) => {
  return React.createElement(
    RN.Modal,
    { visible: true, transparent: true, animationType: "fade", onRequestClose: onClose },
    React.createElement(
      RN.Pressable,
      {
        style: {
          flex: 1,
          backgroundColor: "rgba(0,0,0,0.85)",
          alignItems: "center",
          justifyContent: "center"
        },
        onPress: onClose
      },
      React.createElement(
        RN.Pressable,
        { onPress: () => {} },
        React.createElement(RN.Image, {
          source: { uri: url },
          style: { width: 320, height: 320, borderRadius: 8 },
          resizeMode: "contain"
        })
      )
    )
  );
};

const openImageViewer = (url: string) => {
  try {
    if (closeViewer) {
      closeViewer();
      closeViewer = null;
    }

    const AlertActionCreators = findByProps("openLazy") || findByProps("openAlert");
    // Fall back to a simple manual mount via a top-level modal render if no
    // dedicated overlay API is available.
    if (AlertActionCreators?.openLazy) {
      // Not all builds expose a generic "mount arbitrary component" API, so
      // this uses React Native's own Modal directly instead, mounted via a
      // lightweight root render helper below.
    }

    mountModal(url);
  } catch (e) {
    showToast("Couldn't open image viewer", getAssetIDByName("ic_close_16px"));
  }
};

// Mounts our custom Modal by patching the root app render once, then
// toggling a local "current URL" state to show/hide it. This avoids
// depending on any specific modal-stack API that may differ by version.
let currentViewerUrl: string | null = null;
let setViewerUrlExternally: ((url: string | null) => void) | null = null;
let rootPatchUnpatch: (() => void) | null = null;

const RootOverlay = () => {
  const [url, setUrl] = React.useState<string | null>(currentViewerUrl);

  React.useEffect(() => {
    setViewerUrlExternally = setUrl;
    return () => {
      setViewerUrlExternally = null;
    };
  }, []);

  if (!url) return null;

  return React.createElement(ImageViewerModal, {
    url,
    onClose: () => setUrl(null)
  });
};

const mountModal = (url: string) => {
  currentViewerUrl = url;
  if (setViewerUrlExternally) {
    setViewerUrlExternally(url);
    return;
  }

  // RootOverlay hasn't mounted yet (first use this session) — patching the
  // top-level app renderer to include it, once.
  try {
    const AppRoot = findByName("AppContainer", false) || findByName("App", false);
    if (AppRoot?.default) {
      const def = AppRoot.default;
      const patchKey = typeof def === "function" ? "default" : (def?.type ? "type" : "render");
      const patchObj = patchKey === "default" ? AppRoot : def;

      rootPatchUnpatch = after(patchKey as any, patchObj, (_args: any, ret: any) => {
        return React.createElement(React.Fragment, null, ret, React.createElement(RootOverlay));
      });
    }
  } catch (e) {}
};

closeViewer = () => {
  currentViewerUrl = null;
  if (setViewerUrlExternally) setViewerUrlExternally(null);
};

// --- Patching avatar/banner ------------------------------------------------

const patchTappableImage = (componentName: string, filenamePrefix: string): (() => void) | null => {
  try {
    const mod = findByName(componentName, false);
    if (!mod?.default) return null;

    const def = mod.default;
    const patchKey = typeof def === "function" ? "default" : (def?.type ? "type" : "render");
    const patchObj = patchKey === "default" ? mod : def;

    return after(patchKey as any, patchObj, (_args: any, ret: any) => {
      const url = findImageUrlInTree(ret);
      if (!url) return ret;

      return React.createElement(
        RN.View,
        { style: { position: "relative" } },
        ret,
        React.createElement(RN.Pressable, {
          style: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
          onPress: () => openImageViewer(url),
          onLongPress: () => {
            if (getSettings().downloadEnabled) {
              downloadImageUrl(url, `${filenamePrefix}_${Date.now()}.png`);
            }
          }
        })
      );
    });
  } catch (e) {
    return null;
  }
};

// --- Settings --------------------------------------------------------------

const SettingsComponent = () => {
  const [settings, setSettings] = React.useState(getSettings());

  return React.createElement(
    Forms.FormSection,
    { title: "View Icons" },
    React.createElement(Forms.FormSwitchRow, {
      label: "Long-press to download",
      subLabel: "When on, long-pressing an avatar or banner downloads it directly. Tap-to-view always works either way.",
      value: settings.downloadEnabled,
      onValueChange: (value: boolean) => {
        const updated = { ...settings, downloadEnabled: value };
        Object.assign(storage, updated);
        setSettings(updated);
      }
    })
  );
};

export default {
  onLoad: () => {
    avatarUnpatch = patchTappableImage("UserProfileAvatar", "avatar");
    bannerUnpatch = patchTappableImage("UserProfileBanner", "banner");
  },

  onUnload: () => {
    if (avatarUnpatch) {
      try {
        avatarUnpatch();
      } catch (e) {}
      avatarUnpatch = null;
    }
    if (bannerUnpatch) {
      try {
        bannerUnpatch();
      } catch (e) {}
      bannerUnpatch = null;
    }
    if (rootPatchUnpatch) {
      try {
        rootPatchUnpatch();
      } catch (e) {}
      rootPatchUnpatch = null;
    }
    closeViewer?.();
  },

  settings: SettingsComponent
};
