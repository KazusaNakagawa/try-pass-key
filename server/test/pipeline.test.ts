import { describe, expect, it } from 'vitest';
import {
  AUTHENTICATION_CHECKS,
  REGISTRATION_CHECKS,
  runChecks,
  STEPUP_CHECKS,
  OPERATION_GATE_CHECKS,
} from '../src/webauthn/pipeline.js';
import { CheckError, type Check, type CheckId } from '../src/webauthn/checks/types.js';

/**
 * Guards docs/01 §6 against silent removal. If a check is dropped from the
 * pipeline (for example to make a failing test pass), this test fails.
 * Changing this list requires changing docs/01 §6 and docs/decisions.md.
 */
const byId = (a: string, b: string) => a.localeCompare(b);

const REGISTRATION_ITEMS = [
  'C1',
  'C2',
  'C3',
  'C4',
  'C5',
  'A1',
  'A2',
  'A3',
  'R1',
  'R2',
  'R3',
  'R4',
  'R5',
];

describe('verification pipeline', () => {
  it('runs exactly the registration items from docs/01 §6', () => {
    const ids = REGISTRATION_CHECKS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort(byId)).toEqual([...REGISTRATION_ITEMS].sort(byId));
  });

  it('cannot be modified at runtime', () => {
    expect(Object.isFrozen(REGISTRATION_CHECKS)).toBe(true);
  });

  it('consumes the challenge (C4) before any other check', () => {
    expect(REGISTRATION_CHECKS[0]?.id).toBe('C4');
  });

  describe('login', () => {
    const AUTHENTICATION_ITEMS = [
      'C1',
      'C2',
      'C3',
      'C4',
      'C5',
      'A1',
      'A2',
      'A3',
      'A4',
      'L1',
      'L2',
      'L3',
      'L4',
    ];

    it('runs exactly the login items from docs/01 §6', () => {
      const ids = AUTHENTICATION_CHECKS.map((c) => c.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect([...ids].sort(byId)).toEqual([...AUTHENTICATION_ITEMS].sort(byId));
    });

    it('cannot be modified at runtime', () => {
      expect(Object.isFrozen(AUTHENTICATION_CHECKS)).toBe(true);
    });

    it('consumes the challenge (C4) before any other check', () => {
      expect(AUTHENTICATION_CHECKS[0]?.id).toBe('C4');
    });
  });

  describe('step-up', () => {
    // Login without L2 (userHandle may be absent when allowCredentials is set), plus S1.
    const STEPUP_ITEMS = [
      'C1',
      'C2',
      'C3',
      'C4',
      'C5',
      'A1',
      'A2',
      'A3',
      'A4',
      'L1',
      'L3',
      'L4',
      'S1',
    ];

    it('runs exactly the step-up items from docs/01 §6', () => {
      const ids = STEPUP_CHECKS.map((c) => c.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect([...ids].sort(byId)).toEqual([...STEPUP_ITEMS].sort(byId));
    });

    it('cannot be modified at runtime', () => {
      expect(Object.isFrozen(STEPUP_CHECKS)).toBe(true);
    });

    it('consumes the challenge (C4) before any other check', () => {
      expect(STEPUP_CHECKS[0]?.id).toBe('C4');
    });
  });

  describe('operation gate', () => {
    it('runs S3 then S2', () => {
      expect(OPERATION_GATE_CHECKS.map((c) => c.id)).toEqual(['S3', 'S2']);
    });

    it('cannot be modified at runtime', () => {
      expect(Object.isFrozen(OPERATION_GATE_CHECKS)).toBe(true);
    });
  });

  describe('runChecks', () => {
    it('reports pass for each check and fail for the one that throws, then rethrows', () => {
      const failure = new CheckError('C3', 'origin mismatch');
      const checks: Check<null>[] = [
        { id: 'C4', title: 'first', run: () => undefined },
        {
          id: 'C3',
          title: 'second',
          run: () => {
            throw failure;
          },
        },
        { id: 'A1', title: 'third', run: () => undefined },
      ];
      const calls: [CheckId, string][] = [];
      expect(() => {
        runChecks(null, checks, (id, result) => calls.push([id, result]));
      }).toThrow(failure);
      expect(calls).toEqual([
        ['C4', 'pass'],
        ['C3', 'fail'],
      ]);
    });
  });
});
