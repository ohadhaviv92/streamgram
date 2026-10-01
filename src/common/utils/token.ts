import { randomBytes } from "crypto";

/**
 * Generates a 12-character URL-safe base64 token (72 bits of entropy).
 * Safe to embed directly in URL path segments.
 */
export function generateUserToken(): string {
  return randomBytes(9).toString("base64url");
}
