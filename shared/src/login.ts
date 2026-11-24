import { z } from 'zod';
import { OptionalInspection } from './inspection.js';
import { Base64Url } from './registration.js';

/** POST /api/login/options response (PublicKeyCredentialRequestOptionsJSON). */
export const LoginOptionsResponse = z.object({
  challenge: Base64Url,
  rpId: z.string(),
  timeout: z.number(),
  userVerification: z.literal('required'),
  /** Empty: the authenticator offers its discoverable credentials (no username needed). */
  allowCredentials: z.array(z.never()),
});
export type LoginOptionsResponse = z.infer<typeof LoginOptionsResponse>;

/** POST /api/login/verify request (AuthenticationResponseJSON). */
export const AuthenticationResponse = z.object({
  id: Base64Url,
  rawId: Base64Url,
  type: z.literal('public-key'),
  response: z.object({
    clientDataJSON: Base64Url,
    authenticatorData: Base64Url,
    signature: Base64Url,
    /** user.id from registration. Required here: it is how a discoverable login names the user. */
    userHandle: Base64Url.optional(),
  }),
  clientExtensionResults: z.record(z.string(), z.unknown()),
  authenticatorAttachment: z.enum(['platform', 'cross-platform']).optional(),
});
export type AuthenticationResponse = z.infer<typeof AuthenticationResponse>;

/** GET /api/me response, also returned after login and registration. */
export const MeResponse = z.object({
  userId: z.string(),
  displayName: z.string(),
  /** When this session was created by logging in or registering (ISO 8601). */
  authAt: z.string(),
  /** Last step-up authentication in this session, if any. */
  stepupAt: z.string().nullable(),
  /** Mock balance (M6). */
  balance: z.number(),
});
export type MeResponse = z.infer<typeof MeResponse>;

/** POST /api/login/verify response */
export const LoginVerifyResponse = z.object({
  me: MeResponse,
  credential: z.object({
    id: Base64Url,
    signCount: z.number(),
    backupState: z.boolean(),
  }),
  /** Development only (M4). */
  inspection: OptionalInspection,
});
export type LoginVerifyResponse = z.infer<typeof LoginVerifyResponse>;
