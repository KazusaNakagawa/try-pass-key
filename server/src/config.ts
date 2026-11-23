import { z } from 'zod';

const Env = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  /** Domain that credentials are bound to. Must match the browser-facing host. */
  RP_ID: z.string().min(1).default('localhost'),
  /** Exact origin the browser reports in clientDataJSON (scheme + host + port). */
  RP_ORIGIN: z.url().default('http://localhost:5173'),
  DB_PATH: z.string().min(1).default('/data/app.db'),
});

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
