import { z } from 'zod';
import { LoginVerifyResponse } from './login.js';
import { Base64Url } from './registration.js';

/** POST /api/transfer and POST /api/stepup/options request: the transaction to approve. */
export const TransferRequest = z.object({
  to: z.string().trim().min(1).max(64),
  amount: z.number().int().min(1).max(1_000_000),
});
export type TransferRequest = z.infer<typeof TransferRequest>;

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

export const TransferRecord = z.object({
  id: z.string(),
  to: z.string(),
  amount: z.number(),
  createdAt: z.string(),
});
export type TransferRecord = z.infer<typeof TransferRecord>;

/** POST /api/transfer response */
export const TransferResponse = z.object({ transfer: TransferRecord, balance: z.number() });
export type TransferResponse = z.infer<typeof TransferResponse>;

/** GET /api/transfers response: newest first, at most 20. */
export const TransfersResponse = z.object({
  balance: z.number(),
  transfers: z.array(TransferRecord),
});
export type TransfersResponse = z.infer<typeof TransfersResponse>;
