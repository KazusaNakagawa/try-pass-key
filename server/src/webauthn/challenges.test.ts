import { describe, expect, it } from 'vitest';
import { openDb } from '../db.js';
import { deleteExpiredChallenges, issueChallenge } from './challenges.js';

describe('deleteExpiredChallenges', () => {
  it('deletes only challenges whose expiry has passed', () => {
    const db = openDb(':memory:');
    const t0 = new Date('2026-01-01T00:00:00Z');
    const input = {
      purpose: 'register' as const,
      userHandle: Buffer.alloc(32),
      displayName: 'test-user-1',
    };
    issueChallenge(db, t0, input); // expires at t0 + 5 min
    issueChallenge(db, new Date(t0.getTime() + 3 * 60 * 1000), input); // expires at t0 + 8 min

    expect(deleteExpiredChallenges(db, new Date(t0.getTime() + 6 * 60 * 1000))).toBe(1);
    expect(db.prepare('SELECT count(*) AS n FROM challenges').get()).toEqual({ n: 1 });
  });
});
