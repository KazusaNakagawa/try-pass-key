import { expect } from 'vitest';
import { CheckError, type CheckId } from '../src/webauthn/checks/types.js';

/** Asserts that fn throws a CheckError for the given §6 item. */
export function expectRejectedBy(fn: () => void, id: CheckId): void {
  let caught: unknown;
  try {
    fn();
  } catch (err) {
    caught = err;
  }
  expect(caught, `expected ${id} to reject`).toBeInstanceOf(CheckError);
  expect((caught as CheckError).check).toBe(id);
}
