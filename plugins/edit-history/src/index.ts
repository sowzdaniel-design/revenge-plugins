import { before } from "@vendetta/patcher";
import { findByProps } from "@vendetta/metro";
import { FluxDispatcher, React } from "@vendetta/metro/common";
import { storage } from "@vendetta/plugin";
import { Forms } from "@vendetta/ui/components";
import { showToast } from "@vendetta/ui/toasts";
import { getAssetIDByName } from "@vendetta/ui/assets";

// Based on the real, working approach used by Angelix1/VP's "Message
// Logger" plugin for Vendetta/Revenge: rather than trying to freeze a
// message or inject a separate fake log entry, patch FluxDispatcher's
// dispatch call and rewrite incoming MESSAGE_UPDATE events so the new
// content is APPENDED after the old content (with a separator), instead
// of replacing it — so both versions stay visible in the same message.
//
// That reference plugin has two gaps this fills in, since they're
// exactly what was reported as missing:
// 1. It explicitly skips any edit where the message's author is a bot
//    (`if (originalMessage?.author?.bot) return args;`) — meaning bot
//    reveal/hide button edits are never logged at all. This version logs
//    bot edits by default (toggleable, in case that's ever too noisy).
// 2. It only compares plain text `content`, not embeds. Game bots that
//    build reveal mechanics (memory games, hidden answers, etc.) usually
//    do it by editing an embed's text, not the message's plain content,
//    so this also extracts and diffs embed text (title/description/
//    field values) and appends the old version the same way.

interface Settings {
  includeBotEdits: boolean;
  separator: string;
}

const DEFAULT_SETTINGS: Settings = {
  includeBotEdits: true,
  separator: "`[ EDITED ]`"
};

const getSettings = (): Settings => {
  return { ...DEFAULT_SETTINGS, ...storage };
};

let dispatchUnpatch: (() => void) | null = null;

// Pulls all human-readable text out of an embed (title, description, and
// every field's name/value) into one string, so two embeds can be
// compared even if the bot restructures fields between edits.
const extractEmbedText = (embeds: any[] | undefined): string => {
  if (!Array.isArray(embeds) || embeds.length === 0) return "";

  const parts: string[] = [];
  for (const embed of embeds) {
    if (!embed) continue;
    if (typeof embed.title === "string") parts.push(embed.title);
    if (typeof embed.description === "string") parts.push(embed.description);
    if (Array.isArray(embed.fields)) {
      for (const field of embed.fields) {
        if (typeof field?.name === "string") parts.push(field.name);
        if (typeof field?.value === "string") parts.push(field.value);
      }
    }
    if (typeof embed.footer?.text === "string") parts.push(embed.footer.text);
  }
  return parts.join("\n");
};

let loggedFirstUpdate = false;

const patchMessageUpdates = (): boolean => {
  try {
    if (!FluxDispatcher?.dispatch) {
      showToast("EditHistory: FluxDispatcher not available", getAssetIDByName("ic_close_16px"));
      return false;
    }

    const MessageStore = findByProps("getMessage", "getMessages");
    const ChannelStore = findByProps("getChannel", "getDMFromUserId");
    if (!MessageStore?.getMessage) {
      showToast("EditHistory: MessageStore not found", getAssetIDByName("ic_close_16px"));
      return false;
    }

    dispatchUnpatch = before("dispatch", FluxDispatcher, (args: any[]) => {
      try {
        const event = args[0];
        if (event?.type !== "MESSAGE_UPDATE" || event?.__editHistoryProcessed) return args;

        if (!loggedFirstUpdate) {
          loggedFirstUpdate = true;
          showToast(`EditHistory: MESSAGE_UPDATE seen, content="${String(event?.message?.content).slice(0, 40)}"`, getAssetIDByName("ic_check"));
        }

        const channelId = event?.message?.channel_id || event?.channelId;
        const messageId = event?.message?.id || event?.id;
        if (!channelId || !messageId) return args;

        const originalMessage = MessageStore.getMessage(channelId, messageId);
        if (!originalMessage?.author?.id) {
          showToast("EditHistory: original message not found in store", getAssetIDByName("ic_close_16px"));
          return args;
        }

        const settings = getSettings();
        const isBot = !!originalMessage.author?.bot;
        if (isBot && !settings.includeBotEdits) {
          showToast("EditHistory: skipped (bot edits disabled in settings)", getAssetIDByName("ic_close_16px"));
          return args;
        }

        const oldContent = originalMessage?.content || "";
        const newContent = event?.message?.content ?? oldContent;

        const oldEmbedText = extractEmbedText(originalMessage?.embeds);
        const newEmbedText = extractEmbedText(event?.message?.embeds);

        const contentChanged = newContent !== oldContent;
        const embedChanged = newEmbedText !== oldEmbedText && (oldEmbedText || newEmbedText);

        if (!contentChanged && !embedChanged) {
          showToast(
            `EditHistory: no change detected (old="${oldContent.slice(0, 20)}" new="${newContent.slice(0, 20)}" oldEmbed="${oldEmbedText.slice(0, 20)}" newEmbed="${newEmbedText.slice(0, 20)}")`,
            getAssetIDByName("ic_close_16px")
          );
          return args;
        }

        const separator = `\n\n${settings.separator}\n\n`;

        let combinedContent = newContent;
        if (contentChanged && oldContent) {
          combinedContent = `${oldContent}${separator}${newContent}`;
        }

        if (embedChanged && oldEmbedText) {
          combinedContent = `${combinedContent}${combinedContent ? separator : ""}${oldEmbedText}`;
        }

        args[0] = {
          ...event,
          __editHistoryProcessed: true,
          message: {
            ...(event.message || originalMessage),
            content: combinedContent,
            embeds: event?.message?.embeds ?? originalMessage?.embeds,
            guild_id: event?.message?.guild_id ?? ChannelStore?.getChannel?.(channelId)?.guild_id
          }
        };
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

  const updateSetting = (key: keyof Settings, value: any) => {
    const updated = { ...settings, [key]: value };
    Object.assign(storage, updated);
    setSettings(updated);
  };

  return React.createElement(
    Forms.FormSection,
    { title: "Edit History" },
    React.createElement(Forms.FormSwitchRow, {
      label: "Include bot message edits",
      subLabel: "Also keep edit history for bot messages — needed for game bots that use buttons to reveal/hide content via edits.",
      value: settings.includeBotEdits,
      onValueChange: (value: boolean) => updateSetting("includeBotEdits", value)
    }),
    React.createElement(Forms.FormInput, {
      title: "Separator text",
      value: settings.separator,
      onChange: (value: string) => updateSetting("separator", value)
    })
  );
};

export default {
  onLoad: () => {
    patchMessageUpdates();
  },

  onUnload: () => {
    if (dispatchUnpatch) {
      try {
        dispatchUnpatch();
      } catch (e) {}
      dispatchUnpatch = null;
    }
  },

  settings: SettingsComponent
};
