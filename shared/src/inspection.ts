import { z } from 'zod';

/**
 * What one registration or login looked like to the server (M4, development only):
 * what the browser and authenticator sent, what the server expected, and how far
 * the docs/01 §6 checks got. Shown on the page to learn how WebAuthn works.
 */
export const CheckResult = z.enum(['pass', 'fail', 'not_run']);
export type CheckResult = z.infer<typeof CheckResult>;

export const CeremonyInspection = z.object({
  ceremony: z.enum(['register', 'login']),
  expected: z.object({
    type: z.string(),
    origin: z.string(),
    rpId: z.string(),
    /** SHA-256 of rpId, hex. */
    rpIdHash: z.string(),
  }),
  clientData: z.object({
    /** clientDataJSON as the browser wrote it. */
    json: z.string(),
    type: z.string(),
    /** base64url */
    challenge: z.string(),
    origin: z.string(),
    crossOrigin: z.boolean(),
  }),
  authenticatorData: z.union([
    z.object({
      /** hex */
      rpIdHash: z.string(),
      flags: z.object({
        up: z.boolean(),
        uv: z.boolean(),
        be: z.boolean(),
        bs: z.boolean(),
        at: z.boolean(),
        ed: z.boolean(),
      }),
      signCount: z.number(),
      /** Registration only. */
      aaguid: z.string().optional(),
      /** Registration only, base64url. */
      credentialId: z.string().optional(),
    }),
    /** authenticatorData (or the attestation object) could not be decoded. */
    z.object({ error: z.string() }),
  ]),
  /** Login only: the stored credential the response named, before this login updated it. */
  storedCredential: z
    .object({ signCount: z.number(), backupEligible: z.boolean(), backupState: z.boolean() })
    .optional(),
  /** Every check in pipeline order. */
  checks: z.array(z.object({ id: z.string(), result: CheckResult })),
  failure: z
    .object({
      /** The check that rejected the response, or the one running when decoding failed. */
      check: z.string().optional(),
      /** 'check': a §6 item rejected it. 'malformed': the response could not be decoded. */
      kind: z.enum(['check', 'malformed']),
      message: z.string(),
    })
    .optional(),
});
export type CeremonyInspection = z.infer<typeof CeremonyInspection>;
