import { PersistedInstanceConfig, InvitationRecord } from "../user/instance-profile";

export function normalizeConfig(value: unknown): PersistedInstanceConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid persisted instance config");
  }
  const next = { ...value } as PersistedInstanceConfig;
  if (next.invitations !== undefined) next.invitations = normalizeInvitations(next.invitations);
  if (next.managementInitialized === undefined && (next.users !== undefined || next.adminPasswordHash)) {
    next.managementInitialized = true;
    next.adminProtection = Boolean(next.adminPasswordHash);
  }
  if (next.users !== undefined) {
    if (!next.users || typeof next.users !== "object" || Array.isArray(next.users))
      throw new Error("Invalid persisted account collection");
    for (const [token, user] of Object.entries(next.users)) {
      if (!user || typeof user !== "object" || user.token !== token ||
          typeof user.phone !== "string" || typeof user.sessionString !== "string")
        throw new Error("Invalid persisted account record");
    }
  }
  if (next.invitations && new Set(next.invitations.map(i => i.id)).size !== next.invitations.length)
    throw new Error("Duplicate persisted invitation identity");
  return next;
}

/** Older installations stored invitations by ID, with ISO date strings. */
export function normalizeInvitations(value: unknown): InvitationRecord[] {
  if (value === null) return [];
  if (typeof value !== "object") {
    throw new Error("Invalid persisted invitation collection");
  }
  const records: unknown[] = Array.isArray(value)
    ? value
    : Object.values(value);
  return records.map((record) => {
    if (!record || typeof record !== "object" || Array.isArray(record)) {
      throw new Error("Invalid persisted invitation record");
    }
    const invitation = record as Record<string, unknown>;
    if (invitation.name !== undefined &&
        (typeof invitation.name !== "string" || invitation.name.length > 80))
      throw new Error("Invalid persisted invitation name");
    if (
      typeof invitation.id !== "string" ||
      !invitation.id ||
      typeof invitation.secretHash !== "string" ||
      !/^[a-f0-9]{64}$/.test(invitation.secretHash)
    ) {
      throw new Error("Invalid persisted invitation identity");
    }
    return {
      ...invitation,
      id: invitation.id,
      secretHash: invitation.secretHash,
      createdAt: invitationTimestamp(invitation.createdAt),
      expiresAt: invitationTimestamp(invitation.expiresAt),
      ...(invitation.usedAt !== undefined
        ? { usedAt: invitationTimestamp(invitation.usedAt) }
        : {}),
      ...(invitation.revokedAt !== undefined
        ? { revokedAt: invitationTimestamp(invitation.revokedAt) }
        : {}),
    };
  });
}

function invitationTimestamp(value: unknown): number {
  const timestamp = typeof value === "string" ? Date.parse(value) : value;
  if (
    typeof timestamp !== "number" ||
    !Number.isSafeInteger(timestamp) ||
    timestamp < 0
  ) {
    // Never drop an invalid used/revoked timestamp and accidentally reactivate a link.
    throw new Error("Invalid persisted invitation timestamp");
  }
  return timestamp;
}
