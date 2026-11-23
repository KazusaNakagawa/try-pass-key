import { z } from 'zod';

/** base64url without padding, as used by WebAuthn JSON serialization. */
export const Base64Url = z.string().regex(/^[A-Za-z0-9_-]*$/, 'must be base64url');

const Transport = z.enum(['ble', 'cable', 'hybrid', 'internal', 'nfc', 'smart-card', 'usb']);

/** POST /api/register/options request */
export const RegisterOptionsRequest = z.object({
  /** Stored on the authenticator and synced. Use a test name such as test-user-1. */
  displayName: z.string().trim().min(1).max(64),
});
export type RegisterOptionsRequest = z.infer<typeof RegisterOptionsRequest>;

/** POST /api/register/options response (PublicKeyCredentialCreationOptionsJSON). */
export const RegisterOptionsResponse = z.object({
  rp: z.object({ id: z.string(), name: z.string() }),
  user: z.object({ id: Base64Url, name: z.string(), displayName: z.string() }),
  challenge: Base64Url,
  pubKeyCredParams: z.array(z.object({ type: z.literal('public-key'), alg: z.number() })),
  timeout: z.number(),
  excludeCredentials: z.array(
    z.object({
      id: Base64Url,
      type: z.literal('public-key'),
      transports: z.array(Transport).optional(),
    }),
  ),
  authenticatorSelection: z.object({
    residentKey: z.literal('required'),
    requireResidentKey: z.literal(true),
    userVerification: z.literal('required'),
  }),
  attestation: z.literal('none'),
});
export type RegisterOptionsResponse = z.infer<typeof RegisterOptionsResponse>;

/** POST /api/register/verify request (RegistrationResponseJSON). */
export const RegistrationResponse = z.object({
  id: Base64Url,
  rawId: Base64Url,
  type: z.literal('public-key'),
  response: z.object({
    clientDataJSON: Base64Url,
    attestationObject: Base64Url,
    transports: z.array(z.string()).optional(),
  }),
  clientExtensionResults: z.record(z.string(), z.unknown()),
  authenticatorAttachment: z.enum(['platform', 'cross-platform']).optional(),
});
export type RegistrationResponse = z.infer<typeof RegistrationResponse>;

/** POST /api/register/verify response */
export const RegisterVerifyResponse = z.object({
  userId: z.string(),
  displayName: z.string(),
  credential: z.object({
    id: Base64Url,
    /** COSE algorithm identifier (-7 = ES256, -257 = RS256). */
    alg: z.number(),
    /** Authenticator model. All zeros with attestation "none" on most platforms. */
    aaguid: z.string(),
    signCount: z.number(),
    backupEligible: z.boolean(),
    backupState: z.boolean(),
    transports: z.array(z.string()),
  }),
});
export type RegisterVerifyResponse = z.infer<typeof RegisterVerifyResponse>;
