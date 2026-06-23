import type { TeamIndex } from "./types";

export const DEFAULT_TEAM_NAMES: Record<TeamIndex, string> = {
  0: "Team 1",
  1: "Team 2"
};

export const maxTeamNameLength = 24;

export function normalizeTeamName(value: unknown, fallback: string) {
  const normalized = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
  return normalized || fallback;
}

export function normalizeTeamNames(input: unknown): Record<TeamIndex, string> {
  const value = input && typeof input === "object" ? input as Record<string, unknown> : {};
  return {
    0: normalizeTeamName(value[0] ?? value["0"], DEFAULT_TEAM_NAMES[0]),
    1: normalizeTeamName(value[1] ?? value["1"], DEFAULT_TEAM_NAMES[1])
  };
}

export function validateTeamName(value: unknown, label: string) {
  const normalized = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
  if (!normalized) {
    throw new Error(`${label} name is required.`);
  }
  if (normalized.length > maxTeamNameLength) {
    throw new Error(`${label} name must be ${maxTeamNameLength} characters or fewer.`);
  }
  return normalized;
}

export function validateTeamNames(input: unknown): Record<TeamIndex, string> {
  const value = input && typeof input === "object" ? input as Record<string, unknown> : {};
  return {
    0: validateTeamName(value[0] ?? value["0"], "Team 1"),
    1: validateTeamName(value[1] ?? value["1"], "Team 2")
  };
}
