import { z } from 'zod';

/** base64url without padding, as used by WebAuthn JSON serialization. */
export const Base64Url = z.string().regex(/^[A-Za-z0-9_-]*$/, 'must be base64url');

export const Transport = z.enum(['ble', 'cable', 'hybrid', 'internal', 'nfc', 'smart-card', 'usb']);
export type Transport = z.infer<typeof Transport>;

const isTransport = (value: string): value is Transport =>
  (Transport.options as readonly string[]).includes(value);

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
    // Unknown values are ignored, as the spec requires; sizes are bounded because the
    // list is stored and later sent back in allowCredentials / excludeCredentials.
    transports: z
      .array(z.string().max(32))
      .max(16)
      .optional()
      .transform((values) => values?.filter(isTransport)),
  }),
  clientExtensionResults: z.record(z.string(), z.unknown()),
  authenticatorAttachment: z.enum(['platform', 'cross-platform']).optional(),
});
/** After parsing (unknown transports removed). */
export type RegistrationResponse = z.infer<typeof RegistrationResponse>;
/** As sent by the browser, before parsing. */
export type RegistrationResponseJSON = z.input<typeof RegistrationResponse>;

/** POST /api/register/verify response */
export const RegisterVerifyResponse = z.object({
  userId: z.string(),
  displayName: z.string(),
  /** Registration also logs the user in. */
  authAt: z.string(),
  credential: z.object({
    id: Base64Url,
    /** COSE algorithm identifier (-7 = ES256, -257 = RS256). */
    alg: z.number(),
    /**
     * Authenticator model. Often all zeros with attestation "none", but not always:
     * password-manager extensions such as 1Password report their own AAGUID.
     */
    aaguid: z.string(),
    signCount: z.number(),
    backupEligible: z.boolean(),
    backupState: z.boolean(),
    transports: z.array(Transport),
  }),
});
export type RegisterVerifyResponse = z.infer<typeof RegisterVerifyResponse>;
