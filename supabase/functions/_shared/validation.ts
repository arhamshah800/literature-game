export const maxDisplayNameLength = 24;
export const lobbyCodeLength = 6;

export function validateDisplayName(value: unknown) {
  const normalized = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
  if (!normalized) {
    throw new Error("displayName is required.");
  }
  if (normalized.length > maxDisplayNameLength) {
    throw new Error(`displayName must be ${maxDisplayNameLength} characters or fewer.`);
  }
  return normalized;
}

export function normalizeLobbyCode(value: unknown) {
  return typeof value === "string" ? value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "") : "";
}

export function validateLobbyCode(value: unknown) {
  const normalized = normalizeLobbyCode(value);
  if (normalized.length !== lobbyCodeLength) {
    throw new Error(`lobbyCode must be exactly ${lobbyCodeLength} characters.`);
  }
  return normalized;
}
