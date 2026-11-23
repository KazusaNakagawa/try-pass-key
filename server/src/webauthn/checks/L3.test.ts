import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { expectRejectedBy } from '../../../test/expect-check.js';
import { LoginHarness } from '../../../test/login-harness.js';
import { SoftAuthenticator } from '../../../test/soft-authenticator.js';
import { L3 } from './L3.js';

describe('L3 signature', () => {
  it.each([-7, -257] as const)('verifies a genuine alg %i signature', (alg) => {
    const h = new LoginHarness();
    const ctx = h.validLoginContext(h.register('test-user-1', new SoftAuthenticator({ alg })));
    expect(() => {
      L3.run(ctx);
    }).not.toThrow();
  });

  it('rejects a signature made with another key', () => {
    const h = new LoginHarness();
    const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const ctx = h.validLoginContext(h.register(), { signWith: privateKey });
    expectRejectedBy(() => {
      L3.run(ctx);
    }, 'L3');
  });

  it('rejects when signed data was changed after signing (origin swapped)', () => {
    const h = new LoginHarness();
    const user = h.register();
    const begun = h.beginLogin();
    const genuine = h.assert(begun, user);
    const tampered = h.assert(begun, user, { origin: 'https://evil.example' });
    // Genuine signature, tampered clientDataJSON
    const response = {
      ...genuine,
      response: { ...genuine.response, clientDataJSON: tampered.response.clientDataJSON },
    };
    expectRejectedBy(() => {
      L3.run(h.loginContext(response, begun.ceremonyId));
    }, 'L3');
  });

  it('treats an undecodable signature as invalid', () => {
    const h = new LoginHarness();
    const user = h.register();
    const begun = h.beginLogin();
    const response = h.assert(begun, user);
    response.response.signature = 'AAAA';
    expectRejectedBy(() => {
      L3.run(h.loginContext(response, begun.ceremonyId));
    }, 'L3');
  });
});
