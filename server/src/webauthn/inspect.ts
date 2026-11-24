import type { CeremonyInspection, CheckResult } from '@app/shared';
import type { Config } from '../config.js';
import { toBase64Url } from './bytes.js';
import {
  CheckError,
  type AuthenticationContext,
  type Check,
  type CheckId,
  type RegistrationContext,
} from './checks/types.js';

export interface InspectInput {
  ceremony: 'register' | 'login';
  ctx: RegistrationContext | AuthenticationContext;
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
 */
export function inspectCeremony(input: InspectInput): CeremonyInspection {
  const { ctx } = input;
  const authData = tryRead(() => ctx.authData);
  const attested =
    input.ceremony === 'register'
      ? tryRead(() => (ctx as RegistrationContext).attestedCredentialData)
      : undefined;
  const stored =
    input.ceremony === 'login'
      ? tryRead(() => (ctx as AuthenticationContext).credential)
      : undefined;

  const failedCheck = input.checks.find((c) => input.results.get(c.id) === 'fail')?.id;
  const failure =
    input.failure === undefined
      ? undefined
      : {
          check: input.failure instanceof CheckError ? input.failure.check : failedCheck,
          kind: input.failure instanceof CheckError ? ('check' as const) : ('malformed' as const),
          message: message(input.failure),
        };

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
    authenticatorData:
      'error' in authData
        ? { error: authData.error }
        : {
            rpIdHash: authData.value.rpIdHash.toString('hex'),
            flags: { ...authData.value.flags },
            signCount: authData.value.signCount,
            ...(attested && 'value' in attested
              ? {
                  aaguid: attested.value.aaguid.toString('hex'),
                  credentialId: toBase64Url(attested.value.credentialId),
                }
              : {}),
          },
    ...(stored && 'value' in stored && stored.value
      ? {
          storedCredential: {
            signCount: stored.value.signCount,
            backupEligible: stored.value.backupEligible,
            backupState: stored.value.backupState,
          },
        }
      : {}),
    checks: input.checks.map((c) => ({
      id: c.id,
      result: (input.results.get(c.id) ?? 'not_run') satisfies CheckResult,
    })),
    ...(failure ? { failure } : {}),
  };
}
