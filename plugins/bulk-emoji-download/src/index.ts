import { findByProps, findByStoreName } from "@vendetta/metro";
import { registerCommand } from "@vendetta/commands";
import { ReactNative as RN } from "@vendetta/metro/common";
import { showToast } from "@vendetta/ui/toasts";
import { getAssetIDByName } from "@vendetta/ui/assets";
import { zipSync } from "fflate";

// All findings below come from statically decompiling Discord's actual
// compiled Android bundle, and from a real, published third-party plugin
// (aliernfrog/vd-plugins' Stealmoji) that already uses several of the same
// pieces successfully:
// - EmojiStore.getGuilds()[guildId]?.emojis gives the full emoji array for
//   a server (confirmed real usage in Stealmoji's AddToServerRow.tsx).
// - Custom emoji CDN URLs follow the standard
//   https://cdn.discordapp.com/emojis/{id}.{gif|png} pattern.
// - fetch(url) -> blob() -> FileReader.readAsDataURL() is Stealmoji's own
//   proven way to turn a remote emoji URL into base64 data in this exact
//   runtime.
// - FileManagerUtils' writeFile("cache", relativePath, base64Data, "base64")
//   is a real, existing native bridge call (confirmed via decompiled code
//   showing this exact call pattern already used elsewhere in Discord's
//   own code for writing binary data to the app's cache directory).
//
// Zipping uses fflate instead of jszip — jszip has Node.js-oriented
// internals that can crash immediately on import in this stripped-down
// Hermes/React Native environment (which is what caused the plugin to be
// unable to enable at all). fflate is built to work in any JS environment
// with no Node dependencies.
//
// The one piece not verified against a real, working example is the final
// "hand the finished zip to the user" step (RN's Share API) — this is a
// standard, always-available React Native capability, but hasn't been
// tested live yet and may need adjustment.

let commandUnregister: (() => void) | null = null;

// Manual base64 <-> Uint8Array conversion, avoiding any assumption about
// atob/btoa being available in this JS environment.
const BASE64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

const base64ToUint8Array = (base64: string): Uint8Array => {
  const clean = base64.replace(/[^A-Za-z0-9+/]/g, "");
  const byteLength = Math.floor((clean.length * 3) / 4) - (clean.endsWith("==") ? 2 : clean.endsWith("=") ? 1 : 0);
  const bytes = new Uint8Array(byteLength);

  let byteIndex = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const c1 = BASE64_CHARS.indexOf(clean[i]);
    const c2 = BASE64_CHARS.indexOf(clean[i + 1]);
    const c3 = BASE64_CHARS.indexOf(clean[i + 2]);
    const c4 = BASE64_CHARS.indexOf(clean[i + 3]);

    if (byteIndex < byteLength) bytes[byteIndex++] = (c1 << 2) | (c2 >> 4);
    if (byteIndex < byteLength) bytes[byteIndex++] = ((c2 & 0xf) << 4) | (c3 >> 2);
    if (byteIndex < byteLength) bytes[byteIndex++] = ((c3 & 0x3) << 6) | (c4 & 0x3f);
  }

  return bytes;
};

const uint8ArrayToBase64 = (bytes: Uint8Array): string => {
  let result = "";
  const len = bytes.length;

  for (let i = 0; i < len; i += 3) {
    const b1 = bytes[i];
    const b2 = i + 1 < len ? bytes[i + 1] : 0;
    const b3 = i + 2 < len ? bytes[i + 2] : 0;

    result += BASE64_CHARS[b1 >> 2];
    result += BASE64_CHARS[((b1 & 0x3) << 4) | (b2 >> 4)];
    result += i + 1 < len ? BASE64_CHARS[((b2 & 0xf) << 2) | (b3 >> 6)] : "=";
    result += i + 2 < len ? BASE64_CHARS[b3 & 0x3f] : "=";
  }

  return result;
};

const fetchAsBase64 = (url: string): Promise<string> => {
  return fetch(url)
    .then((resp) => resp.blob())
    .then((blob) => {
      return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    })
    .then((dataUrl) => dataUrl.split(",")[1]); // strip "data:image/png;base64," prefix
};

const getFileManager = (): any => {
  try {
    const mod = findByProps("writeFile", "moveFile");
    if (mod?.writeFile) return mod;
  } catch (e) {}
  return null;
};

const downloadAllServerEmojis = async (guildId: string, guildName: string) => {
  const EmojiStore = findByStoreName("EmojiStore");
  const emojis = EmojiStore?.getGuilds?.()[guildId]?.emojis ?? [];

  if (emojis.length === 0) {
    showToast("This server has no custom emojis", getAssetIDByName("ic_close_16px"));
    return;
  }

  showToast(`Downloading ${emojis.length} emojis...`, getAssetIDByName("ic_download_24px"));

  const files: Record<string, Uint8Array> = {};
  let successCount = 0;

  for (const emoji of emojis) {
    try {
      const ext = emoji.animated ? "gif" : "png";
      const url = `https://cdn.discordapp.com/emojis/${emoji.id}.${ext}`;
      const base64 = await fetchAsBase64(url);
      const safeName = String(emoji.name || emoji.id).replace(/[^a-zA-Z0-9_-]/g, "_");
      files[`${safeName}.${ext}`] = base64ToUint8Array(base64);
      successCount++;
    } catch (e) {
      // Skip individual failures, keep going with the rest.
    }
  }

  if (successCount === 0) {
    showToast("Couldn't download any emojis", getAssetIDByName("ic_close_16px"));
    return;
  }

  try {
    const zipBytes = zipSync(files);
    const zipBase64 = uint8ArrayToBase64(zipBytes);

    const FileManager = getFileManager();
    if (!FileManager) {
      showToast("Couldn't find the file-writing function on this build", getAssetIDByName("ic_close_16px"));
      return;
    }

    const safeGuildName = String(guildName || guildId).replace(/[^a-zA-Z0-9_-]/g, "_");
    const filename = `${safeGuildName}_emojis.zip`;
    const relativePath = `emoji_downloads/${filename}`;

    await FileManager.writeFile("cache", relativePath, zipBase64, "base64");

    let appDir = "";
    try {
      const AppDirModule = findByProps("getAppDir");
      appDir = AppDirModule?.getAppDir?.() || "";
    } catch (e) {}

    const fullPath = `${appDir}cache/${relativePath}`;
    const fileUri = fullPath.startsWith("file://") ? fullPath : `file://${fullPath}`;

    // Discord's own native download bridge (MediaManager, used for every
    // normal image/media download) only works with a genuine remote URL —
    // it fetches the URL itself internally, so it can't be pointed at a
    // file that only exists locally on this device (confirmed: it threw
    // when given our local file:// path). And Android blocks apps from
    // directly sharing a raw local file to other apps without a
    // FileProvider set up in the Android manifest, which a JS-only plugin
    // can't add — that's why the share-sheet route produced a broken link
    // instead of a real file.
    //
    // So: upload the local zip to catbox.moe (a simple, well-known
    // anonymous file host) to get a genuine public URL, then hand that
    // real URL to MediaManager exactly like it were a normal Discord
    // attachment — since at that point it actually is a normal remote
    // download, the same pathway that already works for everything else.
    showToast("Uploading zip...", getAssetIDByName("ic_download_24px"));

    let publicUrl: string;
    try {
      const formData = new FormData();
      formData.append("reqtype", "fileupload");
      formData.append("fileToUpload", { uri: fileUri, type: "application/zip", name: filename } as any);

      const uploadResp = await fetch("https://catbox.moe/user/api.php", {
        method: "POST",
        body: formData as any
      });
      const uploadText = (await uploadResp.text()).trim();

      if (!uploadText.startsWith("http")) {
        throw new Error(uploadText || "upload failed");
      }
      publicUrl = uploadText;
    } catch (e: any) {
      showToast(`Couldn't upload zip: ${String(e?.message || e)}`, getAssetIDByName("ic_close_16px"));
      return;
    }

    try {
      const MediaManager = findByProps("MediaManager")?.MediaManager || RN?.NativeModules?.MediaManager;
      if (MediaManager?.downloadMediaAssetWithContentType) {
        await MediaManager.downloadMediaAssetWithContentType(publicUrl, filename, "application/zip");
      } else if (MediaManager?.downloadMediaAsset) {
        await MediaManager.downloadMediaAsset(publicUrl, filename);
      } else {
        throw new Error("MediaManager not found");
      }
      showToast(`Downloaded ${successCount}/${emojis.length} emojis to Downloads`, getAssetIDByName("ic_check"));
    } catch (e: any) {
      showToast(`Uploaded, but couldn't trigger download: ${String(e?.message || e)}. Link: ${publicUrl}`, getAssetIDByName("ic_close_16px"));
    }
  } catch (e: any) {
    showToast(`Failed to build zip: ${String(e?.message || e)}`, getAssetIDByName("ic_close_16px"));
  }
};

export default {
  onLoad: () => {
    try {
      commandUnregister = registerCommand({
        name: "downloademojis",
        description: "Download all custom emojis in this server as a zip file",
        applicationId: "-1",
        execute: (_args: any, ctx: any) => {
          try {
            const SelectedGuildStore = findByStoreName("SelectedGuildStore");
            const GuildStore = findByStoreName("GuildStore");
            const guildId = ctx?.guild?.id || SelectedGuildStore?.getGuildId?.();

            if (!guildId) {
              showToast("Run this in a server channel, not a DM", getAssetIDByName("ic_close_16px"));
              return;
            }

            const guild = GuildStore?.getGuild?.(guildId);
            downloadAllServerEmojis(guildId, guild?.name || guildId);
          } catch (e: any) {
            showToast(`Error: ${String(e?.message || e)}`, getAssetIDByName("ic_close_16px"));
          }
        }
      });
    } catch (e) {}
  },

  onUnload: () => {
    if (commandUnregister) {
      try {
        commandUnregister();
      } catch (e) {}
      commandUnregister = null;
    }
  }
};
