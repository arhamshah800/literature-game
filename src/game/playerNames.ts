export const maxDisplayNameLength = 24;

export function validateDisplayName(value: unknown) {
  const normalized = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
  if (!normalized) {
    throw new Error("Enter your name first.");
  }
  if (normalized.length > maxDisplayNameLength) {
    throw new Error(`Name must be ${maxDisplayNameLength} characters or fewer.`);
  }
  return normalized;
}
