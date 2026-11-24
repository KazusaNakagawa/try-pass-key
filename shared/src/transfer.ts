import { z } from 'zod';

/** POST /api/transfer request (and the transfer variant of StepupOperation). */
export const TransferRequest = z.object({
  to: z.string().trim().min(1).max(64),
  amount: z.number().int().min(1).max(1_000_000),
});
export type TransferRequest = z.infer<typeof TransferRequest>;

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
