import { z } from 'zod';

/** GET /api/health */
export const HealthResponse = z.object({
  status: z.literal('ok'),
  db: z.object({
    /** Tables that exist in the SQLite database, sorted by name. */
    tables: z.array(z.string()),
  }),
});
export type HealthResponse = z.infer<typeof HealthResponse>;
