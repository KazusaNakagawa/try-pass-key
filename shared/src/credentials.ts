import { z } from 'zod';
import { OptionalInspection } from './inspection.js';
import { Base64Url, Transport } from './registration.js';

/** One passkey of the logged-in user, as listed on the passkey screen (M7). */
export const CredentialSummary = z.object({
  id: Base64Url,
  createdAt: z.string(),
  lastUsedAt: z.string().nullable(),
  backupEligible: z.boolean(),
  backupState: z.boolean(),
  aaguid: z.string(),
  transports: z.array(Transport),
});
export type CredentialSummary = z.infer<typeof CredentialSummary>;

/**
 * GET /api/credentials and DELETE /api/credentials/:id response, oldest first.
 * `rpId` and `userHandle` let the client tell the authenticator which passkeys
 * are still accepted (Signal API).
 */
export const CredentialsResponse = z.object({
  rpId: z.string(),
  userHandle: Base64Url,
  credentials: z.array(CredentialSummary),
});
export type CredentialsResponse = z.infer<typeof CredentialsResponse>;

/** POST /api/credentials/verify response. */
export const AddCredentialVerifyResponse = z.object({
  credential: CredentialSummary,
  /** Development only (M4). */
  inspection: OptionalInspection,
});
export type AddCredentialVerifyResponse = z.infer<typeof AddCredentialVerifyResponse>;
