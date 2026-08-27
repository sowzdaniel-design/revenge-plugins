import { findByStoreName, findByProps } from "@vendetta/metro";
import { showToast } from "@vendetta/ui/toasts";
import { getAssetIDByName } from "@vendetta/ui/assets";
import { registerCommand } from "@vendetta/commands";
import { before } from "@vendetta/patcher";
import { i18n, ReactNative as RN } from "@vendetta/metro/common";
import {
  isServerExcluded,
  isDMExcluded,
  addServerException,
  removeServerException,
  addDMException,
  removeDMException,
  clearAllExceptions,
  getAllExceptions,
  getServerName,
  getDMName
} from "./Settings";
import { React } from "@vendetta/metro/common";
import { Forms } from "@vendetta/ui/components";

let GuildStore: any;
let GuildChannelStore: any;
let ActiveJoinedThreadsStore: any;
let ReadStateStore: any;
let FluxDispatcher: any;
let ChannelStore: any;

let readCommandUnregister: (() => void) | null = null;
let readAllCommandUnregister: (() => void) | null = null;
let readServerCommandUnregister: (() => void) | null = null;
let readDMCommandUnregister: (() => void) | null = null;
let guildListPatchUnpatch: (() => void) | null = null;
let lastUsed = 0;
const COOLDOWN_MS = 60000;

const findModule = (patterns: string[], storeName?: string) => {
  if (storeName) {
    try {
      const store = findByStoreName(storeName);
      if (store) return store;
    } catch (e) {}
  }

  for (const pattern of patterns) {
    try {
      const module = findByProps(pattern);
      if (module) return module;
    } catch (e) {
      continue;
    }
  }

  return null;
};

const initModules = () => {
  GuildStore = findByStoreName("GuildStore");
  GuildChannelStore = findByStoreName("GuildChannelStore") || findByStoreName("ChannelStore");
  ChannelStore = findByStoreName("ChannelStore");
  ReadStateStore = findByStoreName("ReadStateStore");
  ActiveJoinedThreadsStore = findByStoreName("ActiveJoinedThreadsStore") || findByProps("getActiveJoinedThreadsForGuild");
  FluxDispatcher = findByProps("dispatch", "subscribe") || findByStoreName("Dispatcher");
};

const getDMChannels = () => {
  const dmChannels: any[] = [];
  const channelStore = ChannelStore || GuildChannelStore;

  if (!channelStore) return dmChannels;

  if (channelStore.getPrivateChannels) {
    try {
      const privateChannels = channelStore.getPrivateChannels();
      if (privateChannels && typeof privateChannels === 'object') {
        Object.values(privateChannels).forEach((channel: any) => {
          if (channel && channel.id) dmChannels.push(channel);
        });
      }
    } catch (e) {}
  }

  if (dmChannels.length === 0 && channelStore.getSortedPrivateChannels) {
    try {
      const sortedPrivateChannels = channelStore.getSortedPrivateChannels();
      if (Array.isArray(sortedPrivateChannels)) {
        sortedPrivateChannels.forEach((channel: any) => {
          if (channel && channel.id) dmChannels.push(channel);
        });
      }
    } catch (e) {}
  }

  if (dmChannels.length === 0 && channelStore.getChannels) {
    try {
      const meChannels = channelStore.getChannels("@me");
      if (meChannels && meChannels.SELECTABLE) {
        meChannels.SELECTABLE.forEach((c: any) => {
          const channel = c.channel || c;
          if (channel && channel.id) dmChannels.push(channel);
        });
      }
    } catch (e) {}
  }

  if (dmChannels.length === 0 && channelStore.getChannel && ReadStateStore?.getAllReadStates) {
    try {
      const allReadStates = ReadStateStore.getAllReadStates();
      Object.keys(allReadStates).forEach(channelId => {
        try {
          const channel = channelStore.getChannel(channelId);
          if (channel) {
            const isDM = channel.type === 1 || channel.type === 3 || (!channel.guild_id && !channel.guildId);
            if (isDM) dmChannels.push(channel);
          }
        } catch (e) {}
      });
    } catch (e) {}
  }

  return dmChannels;
};

const getServerChannels = () => {
  if (!GuildStore || !ReadStateStore) return [];

  const channels: Array<any> = [];
  const guilds = GuildStore.getGuilds();

  Object.values(guilds).forEach((guild: any) => {
    if (!guild?.id) return;

    try {
      let guildChannels = [];
      const channelStore = GuildChannelStore || ChannelStore;

      if (channelStore?.getChannels) {
        const channelData = channelStore.getChannels(guild.id);
        if (channelData?.SELECTABLE) guildChannels = guildChannels.concat(channelData.SELECTABLE);
        if (channelData?.VOCAL) guildChannels = guildChannels.concat(channelData.VOCAL);
      }

      if (ActiveJoinedThreadsStore?.getActiveJoinedThreadsForGuild) {
        try {
          const threads = ActiveJoinedThreadsStore.getActiveJoinedThreadsForGuild(guild.id);
          const threadChannels = Object.values(threads).flatMap((threadGroup: any) => Object.values(threadGroup || {}));
          guildChannels = guildChannels.concat(threadChannels);
        } catch (e) {}
      }

      guildChannels.forEach((c: any) => {
        const channel = c?.channel || c;
        if (!channel?.id) return;

        // Skip if server is in exceptions
        if (isServerExcluded(guild.id)) return;

        try {
          if (ReadStateStore.hasUnread && ReadStateStore.hasUnread(channel.id)) {
            channels.push({
              channelId: channel.id,
              messageId: ReadStateStore.lastMessageId?.(channel.id) || null,
              readStateType: 0
            });
          }
        } catch (e) {}
      });
    } catch (e) {}
  });

  return channels;
};

const getDMUnreadChannels = () => {
  const channels: Array<any> = [];
  const dmChannels = getDMChannels();

  dmChannels.forEach((channel: any) => {
    if (!channel?.id) return;

    // Skip if DM is in exceptions
    if (isDMExcluded(channel.id)) return;

    try {
      let hasUnread = false;

      if (ReadStateStore.hasUnread) {
        hasUnread = ReadStateStore.hasUnread(channel.id);
      }

      if (!hasUnread && ReadStateStore.getAllReadStates) {
        const allReadStates = ReadStateStore.getAllReadStates();
        const readState = allReadStates[channel.id];
        if (readState) {
          hasUnread = (readState.mentionCount && readState.mentionCount > 0) ||
                     (readState._unreadCount && readState._unreadCount > 0) ||
                     (readState.unreadCount && readState.unreadCount > 0);
        }
      }

      if (hasUnread) {
        channels.push({
          channelId: channel.id,
          messageId: ReadStateStore.lastMessageId?.(channel.id) || null,
          readStateType: 0
        });
      }
    } catch (e) {}
  });

  return channels;
};

const bulkAckNotifications = (type: 'all' | 'server' | 'dm' = 'all') => {
  if (!GuildStore || !ReadStateStore || !FluxDispatcher) return false;

  let channels: Array<any> = [];
  let typeLabel = '';

  switch (type) {
    case 'server':
      channels = getServerChannels();
      typeLabel = 'server';
      break;
    case 'dm':
      channels = getDMUnreadChannels();
      typeLabel = 'DM';
      break;
    case 'all':
    default:
      channels = [...getServerChannels(), ...getDMUnreadChannels()];
      typeLabel = '';
      break;
  }

  if (channels.length === 0) {
    const message = type === 'all'
      ? "No unread notifications found!"
      : `No unread ${typeLabel} notifications found!`;
    showToast(message, getAssetIDByName("ic_message_edit"));
    return true;
  }

  FluxDispatcher.dispatch({
    type: "BULK_ACK",
    context: "APP",
    channels: channels
  });

  const message = type === 'all'
    ? `Cleared ${channels.length} unread notifications!`
    : `Cleared ${channels.length} unread ${typeLabel} notifications!`;

  showToast(message, getAssetIDByName("ic_message_edit"));
  return true;
};

const readMainNotifications = () => {
  const now = Date.now();
  const timeSinceLastUse = now - lastUsed;

  if (timeSinceLastUse < COOLDOWN_MS) {
    const remainingSeconds = Math.ceil((COOLDOWN_MS - timeSinceLastUse) / 1000);
    showToast(`Please wait ${remainingSeconds}s before using again`, getAssetIDByName("ic_close_16px"));
    return;
  }

  lastUsed = now;
  bulkAckNotifications('all');
};

const readAllNotifications = () => {
  const now = Date.now();
  const timeSinceLastUse = now - lastUsed;

  if (timeSinceLastUse < COOLDOWN_MS) {
    const remainingSeconds = Math.ceil((COOLDOWN_MS - timeSinceLastUse) / 1000);
    showToast(`Please wait ${remainingSeconds}s before using again`, getAssetIDByName("ic_close_16px"));
    return;
  }

  lastUsed = now;
  bulkAckNotifications('server');
};

const readServerNotifications = () => {
  const now = Date.now();
  const timeSinceLastUse = now - lastUsed;

  if (timeSinceLastUse < COOLDOWN_MS) {
    const remainingSeconds = Math.ceil((COOLDOWN_MS - timeSinceLastUse) / 1000);
    showToast(`Please wait ${remainingSeconds}s before using again`, getAssetIDByName("ic_close_16px"));
    return;
  }

  lastUsed = now;
  bulkAckNotifications('server');
};

const readDMNotifications = () => {
  const now = Date.now();
  const timeSinceLastUse = now - lastUsed;

  if (timeSinceLastUse < COOLDOWN_MS) {
    const remainingSeconds = Math.ceil((COOLDOWN_MS - timeSinceLastUse) / 1000);
    showToast(`Please wait ${remainingSeconds}s before using again`, getAssetIDByName("ic_close_16px"));
    return;
  }

  lastUsed = now;
  bulkAckNotifications('dm');
};

// Hooks the top-of-guild-list Home/DM icon (same spot as desktop's mark-all-read
// button) so a long-press on it clears everything. Based on the same
// TouchableWithoutFeedback patch pattern used by the published "hide-servers"
// Revenge plugin, which is known to work against the live guild rail.
const patchGuildListButton = () => {
  try {
    guildListPatchUnpatch = before("TouchableWithoutFeedback", RN, (args) => {
      const clone = [...args];
      if (clone[0]?.accessibilityLabel === i18n.Messages.DIRECT_MESSAGES) {
        const original = clone[0].onLongPress;
        clone[0] = {
          ...clone[0],
          onLongPress: () => {
            readMainNotifications();
            if (typeof original === "function") original();
          }
        };
      }
      return clone;
    });
  } catch (e) {}
};

const SettingsComponent = () => {
  const [serverInput, setServerInput] = React.useState("");
  const [dmInput, setDMInput] = React.useState("");
  const [exceptions, setExceptions] = React.useState(getAllExceptions());

  const refreshExceptions = () => {
    setExceptions(getAllExceptions());
  };

  const handleAddServer = () => {
    if (serverInput.trim()) {
      const success = addServerException(serverInput.trim());
      if (success) {
        showToast(`Added server to exceptions`, getAssetIDByName("ic_check"));
        setServerInput("");
        refreshExceptions();
      } else {
        showToast("Server already in exceptions", getAssetIDByName("ic_close_16px"));
      }
    }
  };

  const handleAddDM = () => {
    if (dmInput.trim()) {
      const success = addDMException(dmInput.trim());
      if (success) {
        showToast(`Added DM to exceptions`, getAssetIDByName("ic_check"));
        setDMInput("");
        refreshExceptions();
      } else {
        showToast("DM already in exceptions", getAssetIDByName("ic_close_16px"));
      }
    }
  };

  const handleRemoveServer = (serverId: string) => {
    removeServerException(serverId);
    showToast("Server removed from exceptions", getAssetIDByName("ic_check"));
    refreshExceptions();
  };

  const handleRemoveDM = (channelId: string) => {
    removeDMException(channelId);
    showToast("DM removed from exceptions", getAssetIDByName("ic_check"));
    refreshExceptions();
  };

  const handleClearAll = () => {
    clearAllExceptions();
    showToast("All exceptions cleared", getAssetIDByName("ic_check"));
    refreshExceptions();
  };

  return React.createElement(React.Fragment, null,
    React.createElement(Forms.FormSection, { title: "Server Exceptions" },
      React.createElement(Forms.FormText, { style: { marginBottom: 10 } },
        "Add server IDs to exclude from notification clearing:"
      ),
      React.createElement(Forms.FormInput, {
        placeholder: "Enter server ID (e.g., 1325923169164333178)",
        value: serverInput,
        onChange: setServerInput,
        onSubmitEditing: handleAddServer
      }),
      React.createElement(Forms.FormRow, {
        label: "Add Server",
        onPress: handleAddServer
      }),
      exceptions.servers.map((server, index) =>
        React.createElement(Forms.FormRow, {
          key: server.id,
          label: server.name,
          subLabel: server.id,
          trailing: React.createElement(Forms.FormRow, {
            label: "Remove",
            style: { color: "#ff4757" },
            onPress: () => handleRemoveServer(server.id)
          })
        })
      )
    ),

    React.createElement(Forms.FormSection, { title: "DM Exceptions" },
      React.createElement(Forms.FormText, { style: { marginBottom: 10 } },
        "Add channel IDs to exclude from notification clearing:"
      ),
      React.createElement(Forms.FormInput, {
        placeholder: "Enter channel ID (e.g., 1258452286682697890)",
        value: dmInput,
        onChange: setDMInput,
        onSubmitEditing: handleAddDM
      }),
      React.createElement(Forms.FormRow, {
        label: "Add DM",
        onPress: handleAddDM
      }),
      exceptions.dms.map((dm, index) =>
        React.createElement(Forms.FormRow, {
          key: dm.id,
          label: dm.name,
          subLabel: dm.id,
          trailing: React.createElement(Forms.FormRow, {
            label: "Remove",
            style: { color: "#ff4757" },
            onPress: () => handleRemoveDM(dm.id)
          })
        })
      )
    ),

    React.createElement(Forms.FormSection, { title: "Actions" },
      React.createElement(Forms.FormRow, {
        label: "Clear All Exceptions",
        onPress: handleClearAll
      }),
      React.createElement(Forms.FormText, { style: { marginTop: 10 } },
        "Tip: long-press the Home/DM icon at the top of your server list to instantly clear all unread notifications."
      )
    )
  );
};

export default {
  onLoad: () => {
    initModules();

    try {
      readCommandUnregister = registerCommand({
        name: "read",
        description: "Clear all unread notifications",
        applicationId: "-1",
        execute: () => {
          readMainNotifications();
          return;
        }
      });

      readAllCommandUnregister = registerCommand({
        name: "read all",
        description: "Clear server unread notifications only",
        applicationId: "-1",
        execute: () => {
          readAllNotifications();
          return;
        }
      });

      readServerCommandUnregister = registerCommand({
        name: "read server",
        description: "Clear server unread notifications only",
        applicationId: "-1",
        execute: () => {
          readServerNotifications();
          return;
        }
      });

      readDMCommandUnregister = registerCommand({
        name: "read dm",
        description: "Clear DM unread notifications only",
        applicationId: "-1",
        execute: () => {
          readDMNotifications();
          return;
        }
      });
    } catch (e) {}

    patchGuildListButton();
  },

  onUnload: () => {
    if (readCommandUnregister) {
      try {
        readCommandUnregister();
        readCommandUnregister = null;
      } catch (e) {}
    }
    if (readAllCommandUnregister) {
      try {
        readAllCommandUnregister();
        readAllCommandUnregister = null;
      } catch (e) {}
    }
    if (readServerCommandUnregister) {
      try {
        readServerCommandUnregister();
        readServerCommandUnregister = null;
      } catch (e) {}
    }
    if (readDMCommandUnregister) {
      try {
        readDMCommandUnregister();
        readDMCommandUnregister = null;
      } catch (e) {}
    }
    if (guildListPatchUnpatch) {
      try {
        guildListPatchUnpatch();
        guildListPatchUnpatch = null;
      } catch (e) {}
    }
  },

  settings: SettingsComponent
};
