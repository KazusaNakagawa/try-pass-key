/**
 * Differential test (M5): the valid responses and the docs/01 §6 attack
 * responses go through our pipeline and through @simplewebauthn/server, and
 * both verdicts are pinned. Where they differ, the row says why:
 *   - app:            the library compares what the app hands it; preparing
 *                     that value (a live challenge, a known credential) is the
 *                     app's job, which our pipeline does as a check.
 *   - library_skips:  the response alone shows the problem, and the library
 *                     does not judge it.
 *   - not_compared:   a normal app would not call the library at all.
 * The library is used only here (server/src/webauthn/CLAUDE.md, D11).
 */
import { verifyRegistrationResponse } from '@simplewebauthn/server';
import { describe, expect, it } from 'vitest';
import type { RegistrationResponseJSON } from '@app/shared';
import { saveRegistration } from '../src/webauthn/registration.js';
import { CheckError, type CheckId } from '../src/webauthn/checks/types.js';
import { REGISTRATION_CHECKS, runChecks } from '../src/webauthn/pipeline.js';
import { RegistrationHarness } from './registration-harness.js';
import { SoftAuthenticator } from './soft-authenticator.js';

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
 * the same JSON with what a normal app passes (the challenge it issued to this
 * browser, the configured origin and RP ID, the algorithms it offered).
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
    reason: 'the library compares the challenge it is given; expiry is the store of the app',
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
    reason: 'the library cannot know the challenge was used; consuming it is the app job',
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
    reason: 'the app hands the library the challenge, so binding it to a browser is the app job',
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
    reason: 'the library does not limit the credential ID length (WebAuthn L3 §7.1 step 23)',
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

const cases: Case[] = [...registrationCases.map((c) => ({ ...c, ceremony: 'register' as const }))];

describe('differential test against @simplewebauthn/server', () => {
  it('every row that differs explains why, and every library rejection names its concern', () => {
    const problems = cases.flatMap((c) => [
      ...(c.category !== 'match' && !c.reason ? [`${c.name}: no reason`] : []),
      ...(c.library === 'reject' && !c.libraryError ? [`${c.name}: no libraryError`] : []),
      ...((c.category === 'match') !== ((c.ours === 'accept') === (c.library === 'accept'))
        ? [`${c.name}: category does not fit the verdicts`]
        : []),
    ]);
    expect(problems).toEqual([]);
  });

  it('has a row for every registration check', () => {
    const ids = new Set(cases.filter((c) => c.ceremony === 'register').map((c) => c.check));
    expect(REGISTRATION_CHECKS.map((c) => c.id).filter((id) => !ids.has(id))).toEqual([]);
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
