/** Ignore preferences from the removed catalog when reading older configs or backups. */
export function removeLegacyLiveSelections(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const config = value as Record<string, unknown>;
  if (!config.users || typeof config.users !== "object" || Array.isArray(config.users)) return value;
  return {
    ...config,
    users: Object.fromEntries(Object.entries(config.users).map(([token, record]) => {
      if (!record || typeof record !== "object" || Array.isArray(record)) return [token, record];
      const user = { ...record } as Record<string, unknown>;
      delete user.selectedLiveChannels;
      return [token, user];
    })),
  };
}
