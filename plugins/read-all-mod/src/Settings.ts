import { storage } from "@vendetta/plugin";
import { findByStoreName } from "@vendetta/metro";

interface ExceptionSettings {
  excludedServers: string[];
  excludedDMs: string[];
}

const DEFAULT_SETTINGS: ExceptionSettings = {
  excludedServers: [],
  excludedDMs: []
};

export const getSettings = (): ExceptionSettings => {
  return { ...DEFAULT_SETTINGS, ...storage };
};

export const saveSettings = (settings: ExceptionSettings): void => {
  Object.assign(storage, settings);
};

export const addServerException = (serverId: string): boolean => {
  const settings = getSettings();
  
  if (!settings.excludedServers.includes(serverId)) {
    settings.excludedServers.push(serverId);
    saveSettings(settings);
    return true;
  }
  
  return false;
};

export const removeServerException = (serverId: string): boolean => {
  const settings = getSettings();
  const index = settings.excludedServers.indexOf(serverId);
  
  if (index > -1) {
    settings.excludedServers.splice(index, 1);
    saveSettings(settings);
    return true;
  }
  
  return false;
};

export const addDMException = (channelId: string): boolean => {
  const settings = getSettings();
  
  if (!settings.excludedDMs.includes(channelId)) {
    settings.excludedDMs.push(channelId);
    saveSettings(settings);
    return true;
  }
  
  return false;
};

export const removeDMException = (channelId: string): boolean => {
  const settings = getSettings();
  const index = settings.excludedDMs.indexOf(channelId);
  
  if (index > -1) {
    settings.excludedDMs.splice(index, 1);
    saveSettings(settings);
    return true;
  }
  
  return false;
};

export const isServerExcluded = (serverId: string): boolean => {
  const settings = getSettings();
  return settings.excludedServers.includes(serverId);
};

export const isDMExcluded = (channelId: string): boolean => {
  const settings = getSettings();
  return settings.excludedDMs.includes(channelId);
};

export const getServerName = (serverId: string): string => {
  try {
    const GuildStore = findByStoreName("GuildStore");
    const guild = GuildStore?.getGuild?.(serverId);
    return guild?.name || `Unknown Server (${serverId})`;
  } catch (e) {
    return `Unknown Server (${serverId})`;
  }
};

export const getDMName = (channelId: string): string => {
  try {
    const ChannelStore = findByStoreName("ChannelStore");
    const channel = ChannelStore?.getChannel?.(channelId);
    
    if (channel) {
      if (channel.name) {
        return channel.name;
      } else if (channel.recipients && channel.recipients.length > 0) {
        const UserStore = findByStoreName("UserStore");
        const user = UserStore?.getUser?.(channel.recipients[0]);
        return user?.username ? `@${user.username}` : `Unknown User (${channelId})`;
      }
    }
    
    return `Unknown DM (${channelId})`;
  } catch (e) {
    return `Unknown DM (${channelId})`;
  }
};

// Clear all exceptions
export const clearAllExceptions = (): void => {
  const settings = getSettings();
  settings.excludedServers = [];
  settings.excludedDMs = [];
  saveSettings(settings);
};

export const getAllExceptions = (): { servers: Array<{id: string, name: string}>, dms: Array<{id: string, name: string}> } => {
  const settings = getSettings();
  
  return {
    servers: settings.excludedServers.map(id => ({
      id,
      name: getServerName(id)
    })),
    dms: settings.excludedDMs.map(id => ({
      id,
      name: getDMName(id)
    }))
  };
};
