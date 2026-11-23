import { z } from 'zod';

const Env = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(3000),
    /** Domain that credentials are bound to. Must match the browser-facing host. */
    RP_ID: z.string().min(1).default('localhost'),
    /**
     * Origin the browser reports in clientDataJSON (scheme + host + port).
     * Compared by exact string match (C3), so it is normalized here: a trailing
     * slash is dropped, and a path, query or fragment is rejected rather than
     * silently ignored.
     */
    RP_ORIGIN: z
      .url()
      .default('http://localhost:5173')
      .refine((v) => {
        const u = new URL(v);
        return u.pathname === '/' && u.search === '' && u.hash === '';
      }, 'RP_ORIGIN must be an origin only (scheme://host[:port]), without a path, query or fragment')
      .transform((v) => new URL(v).origin),
    DB_PATH: z.string().min(1).default('/data/app.db'),
  })
  .refine(
    // The RP ID must equal the origin's host or be a registrable suffix of it.
    // Otherwise every ceremony fails (A1); fail at startup instead.
    (e) => {
      const host = new URL(e.RP_ORIGIN).hostname;
      return host === e.RP_ID || host.endsWith(`.${e.RP_ID}`);
    },
    { message: 'RP_ORIGIN host must equal RP_ID or be a subdomain of it', path: ['RP_ORIGIN'] },
  );

export type Config = {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  rpId: string;
  rpOrigin: string;
  dbPath: string;
};

/** Parses environment variables. Throws with a readable message if any value is invalid. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = Env.parse(env);
  return {
    nodeEnv: parsed.NODE_ENV,
    port: parsed.PORT,
    rpId: parsed.RP_ID,
    rpOrigin: parsed.RP_ORIGIN,
    dbPath: parsed.DB_PATH,
  };
}
