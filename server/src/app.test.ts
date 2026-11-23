import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HealthResponse } from '@app/shared';
import { createApp } from './app.js';
import { openDb } from './db.js';

describe('GET /api/health', () => {
  let baseUrl: string;
  let close: () => void;

  beforeAll(async () => {
    const app = createApp({ db: openDb(':memory:') });
    await new Promise<void>((resolve) => {
      const server = app.listen(0, () => {
        baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
        close = () => {
          server.close();
        };
        resolve();
      });
    });
  });

  afterAll(() => {
    close();
  });

  it('returns a body that matches the shared schema', async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    expect(res.status).toBe(200);
    const body = HealthResponse.parse(await res.json());
    expect(body.db.tables).toContain('credentials');
  });

  it('does not advertise Express', async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    expect(res.headers.get('x-powered-by')).toBeNull();
  });
});
