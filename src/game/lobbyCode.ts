export const lobbyCodeLength = 6;

export function normalizeJoinCode(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, lobbyCodeLength);
}
