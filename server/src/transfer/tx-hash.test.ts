import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { transferTxHash } from './tx-hash.js';

describe('transferTxHash', () => {
  it('hashes the canonical JSON with the kind first', () => {
    const expected = createHash('sha256')
      .update('{"kind":"transfer","to":"test-account-1","amount":1000}')
      .digest('base64url');
    expect(transferTxHash({ to: 'test-account-1', amount: 1000 })).toBe(expected);
  });

  it('does not depend on the key order of the input', () => {
    const reordered = { amount: 1000, to: 'test-account-1' };
    expect(transferTxHash(reordered)).toBe(transferTxHash({ to: 'test-account-1', amount: 1000 }));
  });

  it('changes when the amount changes', () => {
    expect(transferTxHash({ to: 'test-account-1', amount: 1001 })).not.toBe(
      transferTxHash({ to: 'test-account-1', amount: 1000 }),
    );
  });

  it('changes when the recipient changes', () => {
    expect(transferTxHash({ to: 'test-account-2', amount: 1000 })).not.toBe(
      transferTxHash({ to: 'test-account-1', amount: 1000 }),
    );
  });
});
