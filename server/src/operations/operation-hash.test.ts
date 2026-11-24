import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { StepupOperation } from '@app/shared';
import { operationHash } from './operation-hash.js';

const sha = (s: string) => createHash('sha256').update(s).digest('base64url');
const TRANSFER: StepupOperation = { kind: 'transfer', to: 'test-account-1', amount: 1000 };

describe('operationHash', () => {
  it('hashes a transfer exactly as M6 did (kind, to, amount)', () => {
    expect(operationHash(TRANSFER)).toBe(
      sha('{"kind":"transfer","to":"test-account-1","amount":1000}'),
    );
  });

  it('does not depend on the key order of the input', () => {
    const reordered = { amount: 1000, to: 'test-account-1', kind: 'transfer' } as const;
    expect(operationHash(reordered)).toBe(operationHash(TRANSFER));
  });

  it('changes when the amount or the recipient changes', () => {
    expect(operationHash({ ...TRANSFER, amount: 1001 })).not.toBe(operationHash(TRANSFER));
    expect(operationHash({ ...TRANSFER, to: 'test-account-2' })).not.toBe(operationHash(TRANSFER));
  });

  it('hashes adding a passkey as just its kind', () => {
    expect(operationHash({ kind: 'add_credential' })).toBe(sha('{"kind":"add_credential"}'));
  });

  it('hashes deleting a passkey with its credential ID', () => {
    expect(operationHash({ kind: 'delete_credential', credentialId: 'AAAA' })).toBe(
      sha('{"kind":"delete_credential","credentialId":"AAAA"}'),
    );
  });

  it('gives every kind, and every deleted credential, its own hash', () => {
    const hashes = [
      operationHash(TRANSFER),
      operationHash({ kind: 'add_credential' }),
      operationHash({ kind: 'delete_credential', credentialId: 'AAAA' }),
      operationHash({ kind: 'delete_credential', credentialId: 'BBBB' }),
    ];
    expect(new Set(hashes).size).toBe(hashes.length);
  });
});
