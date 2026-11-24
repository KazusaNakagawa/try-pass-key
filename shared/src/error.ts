import { z } from 'zod';
import { OptionalInspection } from './inspection.js';

/** Error body for every API error (docs/01 §7). */
export const ApiError = z.object({
  error: z.string(),
  detail: z.string(),
  /** Which verification item from docs/01 §6 failed (C1, A3, R2, ...), if any. */
  check: z.string().optional(),
  /** Development only: the rejected ceremony (M4). */
  inspection: OptionalInspection,
});
export type ApiError = z.infer<typeof ApiError>;
