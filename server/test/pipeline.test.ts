import { describe, expect, it } from 'vitest';
import { AUTHENTICATION_CHECKS, REGISTRATION_CHECKS } from '../src/webauthn/pipeline.js';

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
});
