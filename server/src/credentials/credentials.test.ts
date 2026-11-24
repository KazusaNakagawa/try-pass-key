import { describe, expect, it } from 'vitest';
import { AddCredentialHarness } from '../../test/add-credential-harness.js';
import { SoftAuthenticator } from '../../test/soft-authenticator.js';
import { saveAddedCredential } from '../webauthn/add-credential.js';
import { REGISTRATION_CHECKS, runChecks } from '../webauthn/pipeline.js';
import { deleteCredentialUnlessLast, listCredentials } from './credentials.js';

/** The victim with a second passkey; returns the two credential IDs, oldest first. */
function withTwoPasskeys() {
  const h = new AddCredentialHarness();
  const second = new SoftAuthenticator();
  h.clock = new Date(h.clock.getTime() + 1000);
  const ctx = h.addContext(h.respondAdd(h.beginAdd(h.victim), second), h.sessionFor(h.victim));
  runChecks(ctx, REGISTRATION_CHECKS);
  saveAddedCredential(h.deps, ctx, []);
  return { h, first: h.victim.authenticator.credentialId, second: second.credentialId };
}

describe('listCredentials', () => {
  it("lists the user's passkeys oldest first", () => {
    const { h, first, second } = withTwoPasskeys();
    expect(listCredentials(h.db, h.victim.userId).map((c) => c.id)).toEqual([
      first.toString('base64url'),
      second.toString('base64url'),
    ]);
  });
});

describe('deleteCredentialUnlessLast', () => {
  it('deletes one of two passkeys but never the last one', () => {
    const { h, first, second } = withTwoPasskeys();
    expect(deleteCredentialUnlessLast(h.db, h.victim.userId, first)).toBe(true);
    expect(deleteCredentialUnlessLast(h.db, h.victim.userId, second)).toBe(false);
    expect(h.credentialCount(h.victim.userId)).toBe(1);
  });

  it("does not delete someone else's passkey", () => {
    const { h } = withTwoPasskeys();
    expect(
      deleteCredentialUnlessLast(h.db, h.victim.userId, h.attacker.authenticator.credentialId),
    ).toBe(false);
    expect(h.credentialCount(h.attacker.userId)).toBe(1);
  });
});
