import { z } from 'zod';
import { LoginVerifyResponse } from './login.js';
import { Base64Url } from './registration.js';
import { TransferRequest } from './transfer.js';

/**
 * POST /api/stepup/options request: the operation a step-up approves (docs/01
 * §5.3, §5.4). The approval is bound to this exact operation, kind included, so
 * it cannot be spent on another kind of operation or another target.
 */
export const StepupOperation = z.discriminatedUnion('kind', [
  TransferRequest.extend({ kind: z.literal('transfer') }),
  z.object({ kind: z.literal('add_credential') }),
  z.object({ kind: z.literal('delete_credential'), credentialId: Base64Url.min(1) }),
]);
export type StepupOperation = z.infer<typeof StepupOperation>;

/** POST /api/stepup/options response. Only the logged-in user's credentials are allowed. */
export const StepupOptionsResponse = z.object({
  challenge: Base64Url,
  rpId: z.string(),
  timeout: z.number(),
  userVerification: z.literal('required'),
  allowCredentials: z.array(
    z.object({
      type: z.literal('public-key'),
      id: Base64Url,
      transports: z.array(z.string()).optional(),
    }),
  ),
});
export type StepupOptionsResponse = z.infer<typeof StepupOptionsResponse>;

/** POST /api/stepup/verify response: same shape as a login. */
export const StepupVerifyResponse = LoginVerifyResponse;
export type StepupVerifyResponse = z.infer<typeof StepupVerifyResponse>;
