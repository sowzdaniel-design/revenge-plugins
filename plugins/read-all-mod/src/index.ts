import { findByStoreName, findByProps, findByName, find } from "@vendetta/metro";
import { showToast } from "@vendetta/ui/toasts";
import { getAssetIDByName } from "@vendetta/ui/assets";
import { after } from "@vendetta/patcher";
import { ReactNative as RN } from "@vendetta/metro/common";
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

let guildListPatchUnpatch: (() => void) | null = null;

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
  let strategyUsed = "none";

  if (!channelStore) return { dmChannels, strategyUsed };

  if (channelStore.getPrivateChannels) {
    try {
      const privateChannels = channelStore.getPrivateChannels();
      if (privateChannels && typeof privateChannels === 'object') {
        Object.values(privateChannels).forEach((channel: any) => {
          if (channel && channel.id) dmChannels.push(channel);
        });
        if (dmChannels.length > 0) strategyUsed = "getPrivateChannels";
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
        if (dmChannels.length > 0) strategyUsed = "getSortedPrivateChannels";
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
        if (dmChannels.length > 0) strategyUsed = "getChannels(@me)";
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
      if (dmChannels.length > 0) strategyUsed = `getAllReadStates(${Object.keys(allReadStates).length} entries scanned)`;
    } catch (e) {}
  }

  return { dmChannels, strategyUsed };
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
  const { dmChannels, strategyUsed } = getDMChannels();

  // Fetch once outside the loop instead of once per channel — this was
  // previously called again inside the loop as a fallback check for every
  // single DM, which multiplies its cost by the number of DMs you have.
  let allReadStates: any = null;
  if (ReadStateStore?.getAllReadStates) {
    try {
      allReadStates = ReadStateStore.getAllReadStates();
    } catch (e) {}
  }

  dmChannels.forEach((channel: any) => {
    if (!channel?.id) return;

    // Skip if DM is in exceptions
    if (isDMExcluded(channel.id)) return;

    try {
      let hasUnread = false;

      if (ReadStateStore.hasUnread) {
        hasUnread = ReadStateStore.hasUnread(channel.id);
      }

      if (!hasUnread && allReadStates) {
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

  return { channels, dmCount: dmChannels.length, strategyUsed };
};

const bulkAckNotifications = (type: 'all' | 'server' | 'dm' = 'all') => {
  if (!GuildStore || !ReadStateStore || !FluxDispatcher) return false;

  const startTime = Date.now();
  let channels: Array<any> = [];
  let typeLabel = '';
  let dmDiag = { dmCount: 0, strategyUsed: "n/a" };
  let serverMs = 0, dmMs = 0;

  switch (type) {
    case 'server': {
      const t0 = Date.now();
      channels = getServerChannels();
      serverMs = Date.now() - t0;
      typeLabel = 'server';
      break;
    }
    case 'dm': {
      const t0 = Date.now();
      const dmResult = getDMUnreadChannels();
      dmMs = Date.now() - t0;
      channels = dmResult.channels;
      dmDiag = { dmCount: dmResult.dmCount, strategyUsed: dmResult.strategyUsed };
      typeLabel = 'DM';
      break;
    }
    case 'all':
    default: {
      const t0 = Date.now();
      const serverChannels = getServerChannels();
      serverMs = Date.now() - t0;

      const t1 = Date.now();
      const dmResult = getDMUnreadChannels();
      dmMs = Date.now() - t1;
      dmDiag = { dmCount: dmResult.dmCount, strategyUsed: dmResult.strategyUsed };

      channels = [...serverChannels, ...dmResult.channels];
      typeLabel = '';
      break;
    }
  }

  console.log(`ReadAll timing: server=${serverMs}ms dm=${dmMs}ms dmCount=${dmDiag.dmCount} strategy=${dmDiag.strategyUsed}`);

  if (channels.length === 0) {
    return true;
  }

  FluxDispatcher.dispatch({
    type: "BULK_ACK",
    context: "APP",
    channels: channels
  });

  return true;
};

const readMainNotifications = () => {
  bulkAckNotifications('server');
};

// A small clickable text label, styled to resemble the desktop "Read All"
// link (plain text that highlights/underlines on press rather than a
// boxed button).
const ReadAllLabel = () => {
  const [pressed, setPressed] = React.useState(false);

  return React.createElement(
    RN.Pressable,
    {
      onPress: () => readMainNotifications(),
      onPressIn: () => setPressed(true),
      onPressOut: () => setPressed(false),
      hitSlop: 8,
      style: { paddingVertical: 8, paddingHorizontal: 12, alignSelf: "flex-start" }
    },
    React.createElement(
      RN.Text,
      {
        style: {
          color: pressed ? "#FFFFFF" : "#B5BAC1",
          fontSize: 13,
          fontWeight: "600",
          textDecorationLine: pressed ? "underline" : "none"
        }
      },
      "Read All"
    )
  );
};

// Wraps the guild list's rendered output, prepending our label as a sibling
// above it, rather than trying to inject a fake entry into the list itself.
const ReadAllWrapper = ({ ret }: { ret: any }) => {
  return React.createElement(
    RN.View,
    null,
    React.createElement(ReadAllLabel),
    ret
  );
};

// Same idea, but appends the label AFTER the wrapped content instead of
// before. Used when attaching directly to the "Messages" home-button item
// (GuildsBarMessages) so the label sits just under it, above the separator
// that divides it from the scrollable guild list — matching where desktop's
// equivalent link sits.
const ReadAllAfterWrapper = ({ ret }: { ret: any }) => {
  return React.createElement(
    RN.View,
    null,
    ret,
    React.createElement(ReadAllLabel)
  );
};

// Same technique used by the published "hide-servers" Revenge plugin to
// modify the guild list: patch the connected guild-list component's render
// output "after" it runs, and return a wrapped version of it.
//
// The exact internal component name can drift between Discord versions, so
// this first tries a few known name candidates, then falls back to scanning
// every loaded module's actual source code for the telltale destructured
// prop names ("guildFolders", "unreadGuilds") that component is known to
// use. Property/key names like these normally survive minification even
// when function names don't, so this is a more version-resilient way to
// locate it. Diagnostic details are logged via console.log, which should
// show up in `adb logcat` for troubleshooting.
// Confirmed via static analysis of Discord's actual compiled bundle
// (decompiled Hermes bytecode). The persistent guild rail lives in
// modules/guilds_bar/native/ and is assembled from small per-row
// components; the top "Messages" home icon is its own component,
// GuildsBarMessages (modules/guilds_bar/native/GuildsBarMessages.tsx).
// Attaching directly to that (appending our label after its own render
// output) puts the label right under it, above the separator that divides
// it from the scrollable guild list below — matching the position
// requested. GuildsBar itself is the whole rail's top-level wrapper
// (modules/guilds_bar/native/GuildsBar.tsx) and is used as a fallback if
// the more precise target isn't found, though it would place the label
// above the entire rail rather than just under the Messages icon.
//
// LaunchPad/LaunchPadUnreadServers (modules/launchpad/native/) turned out
// to belong to a separate search/quick-switcher overlay, not the always-
// visible rail, and are kept only as a last-resort fallback.
const PRECISE_TARGET = "GuildsBarMessages";
const GUILD_LIST_CANDIDATES = ["GuildsBar", "LaunchPadUnreadServers", "LaunchPad", "GuildsConnected", "Guilds", "GuildsList", "GuildList"];

type FoundTarget = { mod: any; patchKey: "default" | "type" | "render"; patchObj: any };

const findComponentByName = (name: string): FoundTarget | null => {
  try {
    const mod = find((m: any) => {
      const def = m?.default;
      if (!def) return false;
      if (typeof def === "function" && def.name === name) return true;
      if (def?.type && typeof def.type === "function" && def.type.name === name) return true;
      if (def?.render && typeof def.render === "function" && def.render.name === name) return true;
      return false;
    });

    if (!mod) return null;

    const def = mod.default;
    if (typeof def === "function" && def.name === name) {
      return { mod, patchKey: "default", patchObj: mod };
    }
    if (def?.type && typeof def.type === "function" && def.type.name === name) {
      return { mod, patchKey: "type", patchObj: def };
    }
    if (def?.render && typeof def.render === "function" && def.render.name === name) {
      return { mod, patchKey: "render", patchObj: def };
    }
    return null;
  } catch (e) {
    return null;
  }
};

const findGuildsComponentBySource = () => {
  try {
    return find((m: any) => {
      try {
        const def = m?.default;
        const fn = typeof def === "function" ? def : (def?.type || def?.render);
        if (typeof fn !== "function") return false;
        const src = fn.toString();
        return src.includes("guildFolders") && src.includes("unreadGuilds");
      } catch (e) {
        return false;
      }
    });
  } catch (e) {
    return null;
  }
};

const patchGuildListButton = () => {
  try {
    // Try the precise target first: attach directly to the Messages icon
    // so the label sits right under it.
    const preciseFound = findComponentByName(PRECISE_TARGET);
    if (preciseFound) {
      guildListPatchUnpatch = after(preciseFound.patchKey, preciseFound.patchObj, (_args: any, ret: any) => {
        return React.createElement(ReadAllAfterWrapper, { ret });
      });
      console.log(`ReadAll: patched via precise target "${PRECISE_TARGET}" (key: ${preciseFound.patchKey})`);
      showToast(`ReadAll: label attached under Messages icon`, getAssetIDByName("ic_check"));
      return;
    }

    console.log(`ReadAll: precise target "${PRECISE_TARGET}" not found, trying whole-bar candidates...`);

    for (const name of GUILD_LIST_CANDIDATES) {
      const found = findComponentByName(name);
      if (found) {
        guildListPatchUnpatch = after(found.patchKey, found.patchObj, (_args: any, ret: any) => {
          return React.createElement(ReadAllWrapper, { ret });
        });
        console.log(`ReadAll: patched via "${name}" (key: ${found.patchKey})`);
        showToast(`ReadAll: label attached via "${name}" (approximate position)`, getAssetIDByName("ic_check"));
        return;
      }
    }

    console.log("ReadAll: no named candidate matched, trying source-scan fallback...");
    const bySource = findGuildsComponentBySource();

    if (bySource?.default) {
      const def = bySource.default;
      let patchKey: "default" | "type" | "render" = "default";
      let patchObj: any = bySource;
      let fnName = "anonymous";

      if (typeof def === "function") {
        fnName = def.name || "anonymous";
      } else if (def?.type && typeof def.type === "function") {
        patchKey = "type";
        patchObj = def;
        fnName = def.type.name || "anonymous";
      } else if (def?.render && typeof def.render === "function") {
        patchKey = "render";
        patchObj = def;
        fnName = def.render.name || "anonymous";
      }

      guildListPatchUnpatch = after(patchKey, patchObj, (_args: any, ret: any) => {
        return React.createElement(ReadAllWrapper, { ret });
      });
      console.log(`ReadAll: patched via source-scan, function name = "${fnName}"`);
      showToast(`ReadAll: label attached via source-scan (${fnName})`, getAssetIDByName("ic_check"));
      return;
    }

    console.log("ReadAll: source-scan also found nothing. Dumping findByProps('guildFolders') for reference...");
    try {
      const propsHit = findByProps("guildFolders");
      console.log(`ReadAll: findByProps('guildFolders') result keys = ${propsHit ? Object.keys(propsHit).join(", ") : "null"}`);
    } catch (e) {
      console.log(`ReadAll: findByProps('guildFolders') threw: ${String(e)}`);
    }

    showToast("ReadAll: no matching guild list component found (see logcat)", getAssetIDByName("ic_close_16px"));
  } catch (e: any) {
    console.log(`ReadAll patch error: ${String(e?.stack || e)}`);
    showToast(`ReadAll patch error: ${String(e?.message || e)}`, getAssetIDByName("ic_close_16px"));
  }
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
        "Tip: tap the \"Read All\" label above your server list to instantly clear all unread notifications."
      )
    )
  );
};

export default {
  onLoad: () => {
    initModules();
    patchGuildListButton();
  },

  onUnload: () => {
    if (guildListPatchUnpatch) {
      try {
        guildListPatchUnpatch();
        guildListPatchUnpatch = null;
      } catch (e) {}
    }
  },

  settings: SettingsComponent
};
