import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

describe('loadConfig', () => {
  it('uses defaults that match the compose setup', () => {
    expect(loadConfig({})).toEqual({
      nodeEnv: 'development',
      port: 3000,
      rpId: 'localhost',
      rpOrigin: 'http://localhost:5173',
      dbPath: '/data/app.db',
      inspection: false,
    });
  });

  it('turns the ceremony inspection on only when asked', () => {
    expect(loadConfig({ INSPECTION: 'on' }).inspection).toBe(true);
    expect(loadConfig({ INSPECTION: 'off' }).inspection).toBe(false);
  });

  it('refuses the inspection in production', () => {
    expect(() => loadConfig({ NODE_ENV: 'production', INSPECTION: 'on' })).toThrow(/INSPECTION/);
  });

  it('drops a trailing slash so the exact origin comparison (C3) can match', () => {
    expect(loadConfig({ RP_ORIGIN: 'http://localhost:5173/' }).rpOrigin).toBe(
      'http://localhost:5173',
    );
  });

  it.each(['http://localhost:5173/app', 'http://localhost:5173/?x=1', 'http://localhost:5173/#a'])(
    'rejects an origin with a path, query or fragment: %s',
    (origin) => {
      expect(() => loadConfig({ RP_ORIGIN: origin })).toThrow(/origin only/);
    },
  );

  it('rejects an origin whose host does not match RP_ID', () => {
    expect(() => loadConfig({ RP_ID: 'localhost', RP_ORIGIN: 'http://127.0.0.1:5173' })).toThrow(
      /RP_ID/,
    );
  });

  it('accepts a subdomain of RP_ID but not a look-alike suffix', () => {
    expect(
      loadConfig({ RP_ID: 'example.com', RP_ORIGIN: 'https://app.example.com' }).rpOrigin,
    ).toBe('https://app.example.com');
    expect(() => loadConfig({ RP_ID: 'example.com', RP_ORIGIN: 'https://badexample.com' })).toThrow(
      /RP_ID/,
    );
  });
});
