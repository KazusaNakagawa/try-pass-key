import { describe, expect, it } from 'vitest';
import { expectRejectedBy } from '../../../test/expect-check.js';
import { RegistrationHarness } from '../../../test/registration-harness.js';
import { C4 } from './C4.js';

describe('C4 challenge consumed on first use', () => {
  it('consumes the challenge row', () => {
    const h = new RegistrationHarness();
    const ctx = h.validContext();
    C4.run(ctx);
    expect(h.db.prepare('SELECT count(*) AS n FROM challenges').get()).toEqual({ n: 0 });
  });

  it('rejects when the challenge was already consumed', () => {
    const ctx = new RegistrationHarness().validContext();
    C4.run(ctx);
    expectRejectedBy(() => {
      C4.run(ctx);
    }, 'C4');
  });
});
