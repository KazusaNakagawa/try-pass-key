import type { CeremonyInspection, CheckResult } from '@app/shared';
import type { Config } from '../config.js';
import { toBase64Url } from './bytes.js';
import {
  CheckError,
  type AuthenticationContext,
  type Check,
  type CheckId,
  type RegistrationContext,
  type StepupContext,
} from './checks/types.js';

export interface InspectInput {
  ceremony: 'register' | 'login' | 'stepup' | 'add_credential';
  ctx: RegistrationContext | AuthenticationContext | StepupContext;
  /** The pipeline that ran, in order. */
  checks: readonly Pick<Check<never>, 'id'>[];
  /** What runChecks reported. Checks missing here did not run. */
  results: ReadonlyMap<CheckId, 'pass' | 'fail'>;
  config: Config;
  /** What the checks or the save threw, if anything. */
  failure?: unknown;
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Reads a lazily decoded field; a decode error becomes undefined + its message. */
function tryRead<T>(read: () => T): { value: T } | { error: string } {
  try {
    return { value: read() };
  } catch (err) {
    return { error: message(err) };
  }
}

/**
 * Builds the inspection of one ceremony (M4). Call it only after the checks ran:
 * reading authData decodes it lazily, and C4 must consume the challenge first.
 * Never throws; whatever cannot be decoded is reported as an error string.
 *
 * It reads only what the pipeline itself got to: authData once C2 accepted the
 * challenge (so a stray request costs no decode), and the stored credential only
 * once L3 verified the signature (so naming a credential ID reveals nothing).
 */
export function inspectCeremony(input: InspectInput): CeremonyInspection {
  const { ctx, results } = input;
  const failure = describeFailure(input);
  // A check can also reject after the pipeline (A4 while saving a concurrent
  // login); its row must then read fail, not pass.
  const resultOf = (id: CheckId): CheckResult =>
    failure?.kind === 'check' && failure.check === id ? 'fail' : (results.get(id) ?? 'not_run');
  const authenticatorData = readAuthenticatorData(input);
  const storedCredential = readStoredCredential(input);

  return {
    ceremony: input.ceremony,
    expected: {
      type: ctx.expected.type,
      origin: ctx.expected.origin,
      rpId: input.config.rpId,
      rpIdHash: ctx.expected.rpIdHash.toString('hex'),
    },
    clientData: {
      json: ctx.clientData.raw.toString('utf8'),
      type: ctx.clientData.type,
      challenge: toBase64Url(ctx.clientData.challenge),
      origin: ctx.clientData.origin,
      crossOrigin: ctx.clientData.crossOrigin,
    },
    ...(authenticatorData ? { authenticatorData } : {}),
    ...(storedCredential ? { storedCredential } : {}),
    checks: input.checks.map((c) => ({ id: c.id, result: resultOf(c.id) })),
    ...(failure ? { failure } : {}),
  };
}

function describeFailure(input: InspectInput): CeremonyInspection['failure'] {
  const err = input.failure;
  if (err === undefined) return undefined;
  if (err instanceof CheckError) return { check: err.check, kind: 'check', message: message(err) };
  // A decode error surfaces inside the first check that reads the data.
  const running = input.checks.find((c) => input.results.get(c.id) === 'fail')?.id;
  return { ...(running ? { check: running } : {}), kind: 'malformed', message: message(err) };
}

/**
 * Decoded once, and only after C2 accepted the challenge: a failing lazy decode
 * is not cached by the context, so every further read would parse again.
 */
function readAuthenticatorData(input: InspectInput): CeremonyInspection['authenticatorData'] {
  if (input.results.get('C2') !== 'pass') return undefined;
  const { ctx } = input;
  const authData = tryRead(() => ctx.authData);
  if ('error' in authData) return { error: authData.error };
  const attested = isCreation(input.ceremony)
    ? tryRead(() => (ctx as RegistrationContext).attestedCredentialData)
    : undefined;
  return {
    rpIdHash: authData.value.rpIdHash.toString('hex'),
    flags: { ...authData.value.flags },
    signCount: authData.value.signCount,
    ...(attested && 'value' in attested
      ? {
          aaguid: attested.value.aaguid.toString('hex'),
          credentialId: toBase64Url(attested.value.credentialId),
        }
      : {}),
  };
}

/** Login and step-up, only once L3 verified the signature, so naming a credential ID reveals nothing. */
function readStoredCredential(input: InspectInput): CeremonyInspection['storedCredential'] {
  if (isCreation(input.ceremony) || input.results.get('L3') !== 'pass') return undefined;
  const stored = tryRead(() => (input.ctx as AuthenticationContext).credential);
  if (!('value' in stored) || !stored.value) return undefined;
  const { signCount, backupEligible, backupState } = stored.value;
  return { signCount, backupEligible, backupState };
}

/** A new account or an added passkey: both carry attested credential data. */
function isCreation(ceremony: InspectInput['ceremony']): boolean {
  return ceremony === 'register' || ceremony === 'add_credential';
}
