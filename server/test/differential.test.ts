/**
 * Differential test (M5): the valid responses and the docs/01 §6 attack
 * responses go through our pipeline and through @simplewebauthn/server, and
 * both verdicts are pinned. Where they differ, the row says why:
 *   - app:            the library compares what the app hands it, or returns
 *                     data for the app to compare; preparing or comparing that
 *                     value (a live challenge, a known credential, the stored
 *                     BE) is the app's job, which our pipeline does as a check.
 *                     The test cannot tell this from library_skips; that split
 *                     is the row's own claim.
 *
 * The library gets the challenge that the response answers (the options it
 * came from), as an app does that, like this server, finds the challenge by
 * its value. The app rows for C2/C4/C5 therefore show what the library alone
 * accepts when the app does not check expiry, use or browser binding itself;
 * an app that keeps one challenge per session and drops it after use would
 * hand the library another value (or none) and be rejected there.
 *   - library_skips:  the response alone shows the problem, and the library
 *                     does not judge it.
 *   - not_compared:   a normal app would not call the library at all.
 * The library is used only here (server/src/webauthn/CLAUDE.md, D11).
 */
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { verifyAuthenticationResponse, verifyRegistrationResponse } from '@simplewebauthn/server';
import { describe, expect, it } from 'vitest';
import type { AuthenticationResponse, RegistrationResponseJSON } from '@app/shared';
import { saveAuthentication } from '../src/webauthn/authentication.js';
import { saveRegistration } from '../src/webauthn/registration.js';
import { CheckError, type CheckId } from '../src/webauthn/checks/types.js';
import { AUTHENTICATION_CHECKS, REGISTRATION_CHECKS, runChecks } from '../src/webauthn/pipeline.js';
import { LoginHarness, type RegisteredUser } from './login-harness.js';
import { RegistrationHarness } from './registration-harness.js';
import { SoftAuthenticator, type AssertionOverrides } from './soft-authenticator.js';

type Verdict = 'accept' | CheckId;
type LibraryVerdict = 'accept' | 'reject' | 'not_called';
type Category = 'match' | 'app' | 'library_skips' | 'not_compared';

interface Outcome {
  ours: Verdict;
  library: LibraryVerdict;
  /** The library's error message, or 'verified: false' when it returned that. */
  libraryError?: string;
}

interface Case {
  ceremony: 'register' | 'login';
  /** The §6 item the attack targets; null for a valid response. */
  check: CheckId | null;
  name: string;
  ours: Verdict;
  library: LibraryVerdict;
  /** Fragment of the library's error message; required when library === 'reject'. */
  libraryError?: string;
  category: Category;
  /** Required unless category === 'match'. */
  reason?: string;
  run(): Promise<Outcome>;
}

function ourVerdict(run: () => void): Verdict {
  try {
    run();
    return 'accept';
  } catch (err) {
    if (err instanceof CheckError) return err.check;
    throw err;
  }
}

async function libraryVerdict(
  verify: () => Promise<{ verified: boolean }>,
): Promise<Pick<Outcome, 'library' | 'libraryError'>> {
  try {
    const { verified } = await verify();
    return verified
      ? { library: 'accept' }
      : { library: 'reject', libraryError: 'verified: false' };
  } catch (err) {
    return { library: 'reject', libraryError: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------- registration

/**
 * One registration attempt: our pipeline on the response, then the library on
 * the same JSON with the challenge of the options the response answers, the
 * configured origin and RP ID, and the algorithms those options offered.
 */
async function compareRegistration(
  h: RegistrationHarness,
  begun: ReturnType<RegistrationHarness['begin']>,
  response: RegistrationResponseJSON,
  ceremonyId: string | undefined = begun.ceremonyId,
): Promise<Outcome> {
  const ours = ourVerdict(() => {
    runChecks(h.context(response, ceremonyId), REGISTRATION_CHECKS);
  });
  const library = await libraryVerdict(() =>
    verifyRegistrationResponse({
      response,
      expectedChallenge: begun.options.challenge,
      expectedOrigin: h.deps.config.rpOrigin,
      expectedRPID: h.deps.config.rpId,
      requireUserVerification: true,
      supportedAlgorithmIDs: begun.options.pubKeyCredParams.map((p) => p.alg),
    }),
  );
  return { ours, ...library };
}

/** A fresh registration whose response is tampered as the attack scenario does. */
function registrationAttack(
  overrides: Parameters<RegistrationHarness['respond']>[1],
  authenticator?: SoftAuthenticator,
): () => Promise<Outcome> {
  return () => {
    const h = new RegistrationHarness();
    const begun = h.begin();
    return compareRegistration(h, begun, h.respond(begun, overrides, authenticator));
  };
}

const registrationCases: Omit<Case, 'ceremony'>[] = [
  {
    check: null,
    name: 'valid response',
    ours: 'accept',
    library: 'accept',
    category: 'match',
    run: registrationAttack({}),
  },
  {
    check: 'C1',
    name: 'a login (webauthn.get) response is submitted as a registration',
    ours: 'C1',
    library: 'reject',
    libraryError: 'Unexpected registration response type',
    category: 'match',
    run: registrationAttack({ type: 'webauthn.get' }),
  },
  {
    check: 'C2',
    name: 'a response to an expired challenge is submitted',
    ours: 'C2',
    library: 'accept',
    category: 'app',
    reason: 'the library does not know when a challenge was issued; expiry is the app job',
    run: () => {
      const h = new RegistrationHarness();
      const begun = h.begin();
      h.clock = new Date(h.clock.getTime() + 10 * 60 * 1000);
      return compareRegistration(h, begun, h.respond(begun));
    },
  },
  {
    check: 'C3',
    name: 'a response created on a phishing origin is relayed',
    ours: 'C3',
    library: 'reject',
    libraryError: 'Unexpected response origin',
    category: 'match',
    run: registrationAttack({ origin: 'https://evil.example' }),
  },
  {
    check: 'C3',
    name: 'a response created in a cross-origin iframe (crossOrigin: true)',
    ours: 'C3',
    library: 'accept',
    category: 'library_skips',
    reason: 'verifyRegistrationResponse does not read crossOrigin',
    run: registrationAttack({ crossOrigin: true }),
  },
  {
    check: 'C4',
    name: 'one challenge is used twice to register two credentials',
    ours: 'C2',
    library: 'accept',
    category: 'app',
    reason: 'the library does not know the challenge was used; consuming it is the app job',
    run: () => {
      const h = new RegistrationHarness();
      const begun = h.begin();
      const first = h.context(h.respond(begun), begun.ceremonyId);
      runChecks(first, REGISTRATION_CHECKS);
      saveRegistration(h.deps, first, []);
      return compareRegistration(h, begun, h.respond(begun, {}, new SoftAuthenticator()));
    },
  },
  {
    check: 'C5',
    name: "a leaked response is submitted from the attacker's browser",
    ours: 'C5',
    library: 'accept',
    category: 'app',
    reason: 'the library does not know which browser got the challenge; binding is the app job',
    run: () => {
      const h = new RegistrationHarness();
      const victim = h.begin();
      const attacker = h.begin();
      return compareRegistration(h, victim, h.respond(victim), attacker.ceremonyId);
    },
  },
  {
    check: 'A1',
    name: 'a credential scoped to another RP ID is registered',
    ours: 'A1',
    library: 'reject',
    libraryError: 'Unexpected RP ID hash',
    category: 'match',
    run: registrationAttack({ rpId: 'evil.example' }),
  },
  {
    check: 'A2',
    name: 'the authenticator signs with nobody present (UP=0)',
    ours: 'A2',
    library: 'reject',
    libraryError: 'User presence was required',
    category: 'match',
    run: registrationAttack({ flags: { up: false } }),
  },
  {
    check: 'A3',
    name: 'the credential is created without biometrics or PIN (UV=0)',
    ours: 'A3',
    library: 'reject',
    libraryError: 'User verification was required',
    category: 'match',
    run: registrationAttack({ flags: { uv: false } }),
  },
  {
    check: 'R1',
    name: 'a key with an algorithm the RP did not offer is registered',
    ours: 'R1',
    library: 'reject',
    libraryError: 'Unexpected public key alg',
    category: 'match',
    run: registrationAttack({}, new SoftAuthenticator({ alg: -8 })),
  },
  {
    check: 'R2',
    name: "someone else's credential ID is registered again under a new account",
    ours: 'R2',
    library: 'accept',
    category: 'app',
    reason: 'the library has no credential store; refusing a known credential ID is the app job',
    run: () => {
      const h = new RegistrationHarness();
      const victimAuthenticator = new SoftAuthenticator();
      const first = h.validContext({}, victimAuthenticator);
      runChecks(first, REGISTRATION_CHECKS);
      saveRegistration(h.deps, first, []);
      const begun = h.begin();
      return compareRegistration(h, begun, h.respond(begun, {}, victimAuthenticator));
    },
  },
  {
    check: 'R3',
    name: 'inconsistent backup flags (BE=0, BS=1) are stored',
    ours: 'R3',
    library: 'reject',
    libraryError: 'Single-device credential indicated that it was backed up',
    category: 'match',
    run: registrationAttack({ flags: { be: false, bs: true } }),
  },
  {
    check: 'R4',
    name: 'an oversized (1024-byte) credential ID is stored and echoed back',
    ours: 'R4',
    library: 'accept',
    category: 'library_skips',
    reason: 'the library does not limit the credential ID length (WebAuthn L3 §7.1)',
    run: registrationAttack({}, new SoftAuthenticator({ credentialIdLength: 1024 })),
  },
  {
    check: 'R5',
    name: 'a factorable RSA key (1024-bit, e = 3) is registered',
    ours: 'R5',
    library: 'accept',
    category: 'library_skips',
    reason: 'the library checks the algorithm, not the RSA modulus length or exponent',
    run: registrationAttack(
      {},
      new SoftAuthenticator({ alg: -257, rsa: { modulusLength: 1024, publicExponent: 3 } }),
    ),
  },
];

// ----------------------------------------------------------------------- login

/**
 * One login attempt: our pipeline on the response, then the library on the same
 * JSON with the challenge of the options the response answers and the stored
 * credential the response's credential ID finds. When no credential is found,
 * the app has nothing to hand the library and rejects before calling it.
 */
async function compareLogin(
  h: LoginHarness,
  begun: ReturnType<LoginHarness['beginLogin']>,
  response: AuthenticationResponse,
  ceremonyId: string | undefined = begun.ceremonyId,
): Promise<Outcome> {
  const ctx = h.loginContext(response, ceremonyId);
  const ours = ourVerdict(() => {
    runChecks(ctx, AUTHENTICATION_CHECKS);
  });
  const stored = ctx.credential;
  if (!stored) return { ours, library: 'not_called' };
  const library = await libraryVerdict(() =>
    verifyAuthenticationResponse({
      response,
      expectedChallenge: begun.options.challenge,
      expectedOrigin: h.deps.config.rpOrigin,
      expectedRPID: h.deps.config.rpId,
      requireUserVerification: true,
      credential: {
        id: stored.id.toString('base64url'),
        publicKey: new Uint8Array(stored.publicKey),
        counter: stored.signCount,
      },
    }),
  );
  return { ours, ...library };
}

/** A registered user logs in with a response tampered as the attack scenario does. */
function loginAttack(overrides: AssertionOverrides): () => Promise<Outcome> {
  return () => {
    const h = new LoginHarness();
    const user = h.register();
    const begun = h.beginLogin();
    return compareLogin(h, begun, h.assert(begun, user, overrides));
  };
}

const loginCases: Omit<Case, 'ceremony'>[] = [
  {
    check: null,
    name: 'valid response',
    ours: 'accept',
    library: 'accept',
    category: 'match',
    run: loginAttack({}),
  },
  {
    check: 'C1',
    name: 'a registration (webauthn.create) response is used to log in',
    ours: 'C1',
    library: 'reject',
    libraryError: 'Unexpected authentication response type',
    category: 'match',
    run: loginAttack({ type: 'webauthn.create' }),
  },
  {
    check: 'C2',
    name: 'a response to an expired challenge is submitted',
    ours: 'C2',
    library: 'accept',
    category: 'app',
    reason: 'the library does not know when a challenge was issued; expiry is the app job',
    run: () => {
      const h = new LoginHarness();
      const user = h.register();
      const begun = h.beginLogin();
      h.clock = new Date(h.clock.getTime() + 10 * 60 * 1000);
      return compareLogin(h, begun, h.assert(begun, user));
    },
  },
  {
    check: 'C3',
    name: 'a response created on a phishing origin is relayed',
    ours: 'C3',
    library: 'reject',
    libraryError: 'Unexpected response origin',
    category: 'match',
    run: loginAttack({ origin: 'https://evil.example' }),
  },
  {
    check: 'C3',
    name: 'a response created in a cross-origin iframe (crossOrigin: true, no topOrigin)',
    ours: 'C3',
    library: 'accept',
    category: 'library_skips',
    reason: 'verifyAuthenticationResponse checks crossOrigin only when topOrigin is present',
    run: loginAttack({ crossOrigin: true }),
  },
  {
    check: 'C4',
    name: 'a captured login response is replayed',
    ours: 'C2',
    library: 'accept',
    category: 'app',
    reason: 'the library does not know the challenge was used; consuming it is the app job',
    run: () => {
      const h = new LoginHarness();
      const user = h.register();
      const begun = h.beginLogin();
      const response = h.assert(begun, user);
      const first = h.loginContext(response, begun.ceremonyId);
      runChecks(first, AUTHENTICATION_CHECKS);
      saveAuthentication(h.deps, first);
      return compareLogin(h, begun, response);
    },
  },
  {
    check: 'C5',
    name: "a leaked login response is submitted from the attacker's browser",
    ours: 'C5',
    library: 'accept',
    category: 'app',
    reason: 'the library does not know which browser got the challenge; binding is the app job',
    run: () => {
      const h = new LoginHarness();
      const user = h.register();
      const victim = h.beginLogin();
      const attacker = h.beginLogin();
      return compareLogin(h, victim, h.assert(victim, user), attacker.ceremonyId);
    },
  },
  {
    check: 'A1',
    name: 'a signature from a credential scoped to another RP ID',
    ours: 'A1',
    library: 'reject',
    libraryError: 'Unexpected RP ID hash',
    category: 'match',
    run: loginAttack({ rpId: 'evil.example' }),
  },
  {
    check: 'A2',
    name: 'the authenticator signs with nobody present (UP=0)',
    ours: 'A2',
    library: 'reject',
    libraryError: 'User not present',
    category: 'match',
    run: loginAttack({ flags: { up: false } }),
  },
  {
    check: 'A3',
    name: 'login without biometrics or PIN (UV=0)',
    ours: 'A3',
    library: 'reject',
    libraryError: 'User verification required',
    category: 'match',
    run: loginAttack({ flags: { uv: false } }),
  },
  {
    check: 'L1',
    name: 'a key that was never registered is used',
    ours: 'L1',
    library: 'not_called',
    category: 'not_compared',
    reason: 'no stored credential to hand the library; the app rejects before calling it',
    run: loginAttack({ credentialId: randomBytes(16) }),
  },
  {
    check: 'L2',
    name: "the attacker signs with their own key and sends the victim's userHandle",
    ours: 'L2',
    library: 'accept',
    category: 'app',
    reason:
      'the library verifies the signature of the credential it is given; the app picks the user',
    run: () => {
      const h = new LoginHarness();
      const victim: RegisteredUser = h.register('test-user-1');
      const attacker = h.register('test-user-2');
      const begun = h.beginLogin();
      return compareLogin(h, begun, h.assert(begun, attacker, { userHandle: victim.userHandle }));
    },
  },
  {
    check: 'L3',
    name: 'the signature is forged with a key the attacker controls',
    ours: 'L3',
    library: 'reject',
    libraryError: 'verified: false',
    category: 'match',
    run: loginAttack({ signWith: generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey }),
  },
  {
    check: 'L4',
    name: 'a device-bound credential (BE=0) reports itself as synced (BE=1, BS=1)',
    ours: 'L4',
    library: 'accept',
    category: 'app',
    reason: 'the library returns the BE/BS flags; comparing them with the stored BE is the app job',
    run: () => {
      const h = new LoginHarness();
      const deviceBound = new SoftAuthenticator({ flags: { be: false, bs: false } });
      const user = h.register('test-user-1', deviceBound);
      const begun = h.beginLogin();
      return compareLogin(h, begun, h.assert(begun, user, { flags: { be: true, bs: true } }));
    },
  },
  {
    check: 'A4',
    name: 'a cloned authenticator reuses a signCount that was already seen',
    ours: 'A4',
    library: 'reject',
    libraryError: 'Response counter value 5 was lower than expected 5',
    category: 'match',
    run: () => {
      const h = new LoginHarness();
      const user = h.register();
      h.setStoredSignCount(user, 5);
      const begun = h.beginLogin();
      return compareLogin(h, begun, h.assert(begun, user, { signCount: 5 }));
    },
  },
];

const cases: Case[] = [
  ...registrationCases.map((c) => ({ ...c, ceremony: 'register' as const })),
  ...loginCases.map((c) => ({ ...c, ceremony: 'login' as const })),
];

/** 'match' when both agree; the kind of disagreement is the row's own claim. */
function categoryOf(c: Case): Category {
  if (c.library === 'not_called') return 'not_compared';
  if ((c.ours === 'accept') === (c.library === 'accept')) return 'match';
  return c.category === 'app' || c.category === 'library_skips' ? c.category : 'app';
}

describe('differential test against @simplewebauthn/server', () => {
  it('every row that differs explains why, and every library rejection names its concern', () => {
    const problems = cases.flatMap((c) => [
      ...(c.category !== 'match' && !c.reason ? [`${c.name}: no reason`] : []),
      ...(c.library === 'reject' && !c.libraryError ? [`${c.name}: no libraryError`] : []),
      ...(c.category !== categoryOf(c) ? [`${c.name}: category does not fit the verdicts`] : []),
    ]);
    expect(problems).toEqual([]);
  });

  it('has a row for every registration check', () => {
    const ids = new Set(cases.filter((c) => c.ceremony === 'register').map((c) => c.check));
    expect(REGISTRATION_CHECKS.map((c) => c.id).filter((id) => !ids.has(id))).toEqual([]);
  });

  it('has a row for every login check', () => {
    const ids = new Set(cases.filter((c) => c.ceremony === 'login').map((c) => c.check));
    expect(AUTHENTICATION_CHECKS.map((c) => c.id).filter((id) => !ids.has(id))).toEqual([]);
  });

  describe.each(cases)('$ceremony: $name', (c) => {
    it(`ours: ${c.ours}, library: ${c.library} (${c.category})`, async () => {
      const outcome = await c.run();
      expect({
        ours: outcome.ours,
        library: outcome.library,
        // The library must reject for the attacked concern, not for some unrelated input error.
        libraryErrorMatches: (outcome.libraryError ?? '').includes(c.libraryError ?? ''),
        libraryErrorSeen: outcome.libraryError,
      }).toEqual({
        ours: c.ours,
        library: c.library,
        libraryErrorMatches: true,
        libraryErrorSeen: outcome.libraryError,
      });
    });
  });
});
