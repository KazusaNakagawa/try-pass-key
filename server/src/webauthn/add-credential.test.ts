import { describe, expect, it } from 'vitest';
import { AddCredentialHarness } from '../../test/add-credential-harness.js';
import { SoftAuthenticator } from '../../test/soft-authenticator.js';
import { sessionOf } from '../../test/stepup-harness.js';
import { findChallenge } from './challenges.js';
import { saveAddedCredential } from './add-credential.js';
import { REGISTRATION_CHECKS, runChecks } from './pipeline.js';

describe('createAddCredentialOptions', () => {
  it("uses the existing user's handle and name", () => {
    const h = new AddCredentialHarness();
    const options = h.beginAdd(h.victim);
    expect(Buffer.from(options.user.id, 'base64url')).toEqual(h.victim.userHandle);
    expect(options.user).toMatchObject({ name: 'test-user-1', displayName: 'test-user-1' });
    expect(options.authenticatorSelection).toMatchObject({
      residentKey: 'required',
      userVerification: 'required',
    });
  });

  it("excludes the user's existing passkeys, and only theirs", () => {
    const h = new AddCredentialHarness();
    const options = h.beginAdd(h.victim);
    expect(options.excludeCredentials.map((c) => c.id)).toEqual([
      h.victim.authenticator.credentialId.toString('base64url'),
    ]);
  });

  it('stores the user and the session on an add_credential row', () => {
    const h = new AddCredentialHarness();
    const options = h.beginAdd(h.victim, 'session-a');
    const row = findChallenge(h.db, Buffer.from(options.challenge, 'base64url'));
    expect(row).toMatchObject({
      purpose: 'add_credential',
      userId: h.victim.userId,
      sessionId: 'session-a',
      userHandle: null,
      txHash: null,
    });
  });

  it('cannot store an add_credential row without a user or a session (schema CHECK)', () => {
    const h = new AddCredentialHarness();
    expect(() =>
      h.db
        .prepare(
          `INSERT INTO challenges (id, challenge, purpose, session_id, expires_at)
           VALUES ('x', x'01', 'add_credential', 's', '2099-01-01T00:00:00Z')`,
        )
        .run(),
    ).toThrow(/CHECK/);
    expect(() =>
      h.db
        .prepare(
          `INSERT INTO challenges (id, challenge, purpose, user_id, expires_at)
           VALUES ('y', x'02', 'add_credential', ?, '2099-01-01T00:00:00Z')`,
        )
        .run(h.victim.userId),
    ).toThrow(/CHECK/);
  });
});

describe('saveAddedCredential', () => {
  it('adds a second passkey to the existing user without creating a user', () => {
    const h = new AddCredentialHarness();
    const users = () => (h.db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n;
    const before = users();
    const authenticator = new SoftAuthenticator();
    const ctx = h.addContext(h.respondAdd(h.beginAdd(h.victim), authenticator), {
      sessionUserId: h.victim.userId,
      sessionId: sessionOf(h.victim.userId),
    });
    runChecks(ctx, REGISTRATION_CHECKS);
    const saved = saveAddedCredential(h.deps, ctx, ['internal']);
    expect(saved.userId).toBe(h.victim.userId);
    expect(saved.credential).toMatchObject({
      id: authenticator.credentialId.toString('base64url'),
      transports: ['internal'],
    });
    expect(h.credentialCount(h.victim.userId)).toBe(2);
    expect(users()).toBe(before);
  });
});
