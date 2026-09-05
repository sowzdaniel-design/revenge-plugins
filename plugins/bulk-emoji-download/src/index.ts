import { findByProps, findByStoreName } from "@vendetta/metro";
import { registerCommand } from "@vendetta/commands";
import { ReactNative as RN } from "@vendetta/metro/common";
import { showToast } from "@vendetta/ui/toasts";
import { getAssetIDByName } from "@vendetta/ui/assets";
import JSZip from "jszip";

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
// The one piece not verified against a real, working example is the final
// "hand the finished zip to the user" step (RN's Share API) — this is a
// standard, always-available React Native capability, but hasn't been
// tested live yet and may need adjustment.

let commandUnregister: (() => void) | null = null;

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

  const zip = new JSZip();
  let successCount = 0;

  for (const emoji of emojis) {
    try {
      const ext = emoji.animated ? "gif" : "png";
      const url = `https://cdn.discordapp.com/emojis/${emoji.id}.${ext}`;
      const base64 = await fetchAsBase64(url);
      const safeName = String(emoji.name || emoji.id).replace(/[^a-zA-Z0-9_-]/g, "_");
      zip.file(`${safeName}.${ext}`, base64, { base64: true });
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
    const zipBase64 = await zip.generateAsync({ type: "base64" });
    const FileManager = getFileManager();
    if (!FileManager) {
      showToast("Couldn't find the file-writing function on this build", getAssetIDByName("ic_close_16px"));
      return;
    }

    const safeGuildName = String(guildName || guildId).replace(/[^a-zA-Z0-9_-]/g, "_");
    const relativePath = `emoji_downloads/${safeGuildName}_emojis.zip`;

    await FileManager.writeFile("cache", relativePath, zipBase64, "base64");

    // Hand the finished file to the user via the OS share sheet, so they
    // can save it wherever they like (Downloads, Drive, etc.).
    let appDir = "";
    try {
      const AppDirModule = findByProps("getAppDir");
      appDir = AppDirModule?.getAppDir?.() || "";
    } catch (e) {}

    const fullPath = `${appDir}cache/${relativePath}`;
    const fileUri = fullPath.startsWith("file://") ? fullPath : `file://${fullPath}`;

    try {
      await RN.Share.share({ url: fileUri, title: `${safeGuildName} emojis.zip` });
    } catch (e) {
      showToast(`Saved to app cache: ${relativePath} (share failed, see settings for manual path)`, getAssetIDByName("ic_check"));
      return;
    }

    showToast(`Downloaded ${successCount}/${emojis.length} emojis`, getAssetIDByName("ic_check"));
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
