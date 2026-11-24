import type { AddressInfo } from 'node:net';
import type { DatabaseSync } from 'node:sqlite';
import { createApp } from '../src/app.js';
import type { Config } from '../src/config.js';
import { openDb } from '../src/db.js';
import { TEST_CONFIG } from './registration-harness.js';

/** Starts the real app on a random port. A tiny cookie jar plays the browser. */
export async function startTestServer(config: Config = TEST_CONFIG) {
  const db: DatabaseSync = openDb(':memory:');
  const app = createApp({ db, config });
  const { baseUrl, close } = await new Promise<{ baseUrl: string; close: () => void }>(
    (resolve) => {
      const server = app.listen(0, () => {
        resolve({
          baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
          close: () => {
            server.close();
          },
        });
      });
    },
  );
  return { db, baseUrl, close };
}

export class Browser {
  readonly cookies = new Map<string, string>();

  constructor(private readonly baseUrl: string) {}

  async request(method: 'GET' | 'POST', path: string, body?: unknown): Promise<Response> {
    const headers: Record<string, string> = { origin: TEST_CONFIG.rpOrigin };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (this.cookies.size > 0) {
      headers.cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    }
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const line of res.headers.getSetCookie()) {
      const [pair = '', ...attrs] = line.split(';');
      const eq = pair.indexOf('=');
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      const cleared = value === '' || attrs.some((a) => /expires=thu, 01 jan 1970/i.test(a));
      if (cleared) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
    return res;
  }
}
