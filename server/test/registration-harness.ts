import type { DatabaseSync } from 'node:sqlite';
import { RegistrationResponse, type RegistrationResponseJSON } from '@app/shared';
import { loadConfig, type Config } from '../src/config.js';
import { openDb } from '../src/db.js';
import type { RegistrationContext } from '../src/webauthn/checks/types.js';
import {
  buildRegistrationContext,
  createRegistrationOptions,
  type RegistrationDeps,
} from '../src/webauthn/registration.js';
import { SoftAuthenticator, type AttestationOverrides } from './soft-authenticator.js';

export const TEST_CONFIG: Config = loadConfig({ NODE_ENV: 'test' });

/**
 * One registration ceremony against an in-memory database:
 * options are issued, a soft authenticator answers, and the context is built.
 */
export class RegistrationHarness {
  readonly db: DatabaseSync = openDb(':memory:');
  clock = new Date('2026-01-01T00:00:00Z');
  readonly deps: RegistrationDeps;

  constructor(config: Config = TEST_CONFIG) {
    this.deps = { db: this.db, config, now: () => this.clock };
  }

  /** Issues options in "this browser" and returns what the browser keeps. */
  begin(displayName = 'test-user-1') {
    return createRegistrationOptions(this.deps, displayName);
  }

  respond(
    begun: ReturnType<RegistrationHarness['begin']>,
    overrides: AttestationOverrides = {},
    authenticator = new SoftAuthenticator(),
  ): RegistrationResponseJSON {
    return authenticator.createCredential(
      {
        challenge: begun.options.challenge,
        origin: this.deps.config.rpOrigin,
        rpId: this.deps.config.rpId,
      },
      overrides,
    );
  }

  /** Parses the response like the route does, then builds the context. */
  context(response: RegistrationResponseJSON, ceremonyId: string | undefined): RegistrationContext {
    return buildRegistrationContext(this.deps, {
      response: RegistrationResponse.parse(response),
      ceremonyId,
    });
  }

  /** A valid context for a fresh ceremony, optionally with tampered fields. */
  validContext(
    overrides: AttestationOverrides = {},
    authenticator?: SoftAuthenticator,
  ): RegistrationContext {
    const begun = this.begin();
    return this.context(this.respond(begun, overrides, authenticator), begun.ceremonyId);
  }
}
