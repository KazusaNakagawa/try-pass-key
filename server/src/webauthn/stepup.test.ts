import { describe, expect, it } from 'vitest';
import { StepupHarness } from '../../test/stepup-harness.js';
import { HttpError } from '../http/errors.js';
import { createSession, loadSession } from '../session/sessions.js';
import { runChecks, STEPUP_CHECKS } from './pipeline.js';
import { approveStepup } from './stepup.js';

function verifiedStepup() {
  const h = new StepupHarness();
  const user = h.register();
  const { token } = createSession(h.db, { id: user.userId, displayName: 'test-user-1' }, h.clock);
  const ctx = h.validStepupContext(user, { signCount: 7 });
  runChecks(ctx, STEPUP_CHECKS);
  const signCount = () =>
    (h.db.prepare('SELECT sign_count FROM credentials').get() as { sign_count: number }).sign_count;
  return { h, ctx, token, signCount };
}

describe('approveStepup', () => {
  it('records the counter and moves the session to a new token with the approval', () => {
    const { h, ctx, token, signCount } = verifiedStepup();
    const approved = approveStepup(h.deps, ctx, token);
    expect(signCount()).toBe(7);
    expect(loadSession(h.db, token, h.clock)).toBeUndefined();
    expect(loadSession(h.db, approved.token, h.clock)?.stepupAt).toBe(h.clock.toISOString());
  });

  it('answers 401 and records nothing when the session is gone', () => {
    const { h, ctx, signCount } = verifiedStepup();
    let caught: unknown;
    try {
      approveStepup(h.deps, ctx, 'logged-out-meanwhile');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(HttpError);
    expect(caught).toMatchObject({ status: 401 });
    expect(signCount()).toBe(0);
  });

  it('rolls the counter back when the new session cannot be written', () => {
    const { h, ctx, token, signCount } = verifiedStepup();
    h.db.exec(
      "CREATE TRIGGER fail_insert BEFORE INSERT ON sessions BEGIN SELECT RAISE(ABORT, 'disk full'); END",
    );
    expect(() => approveStepup(h.deps, ctx, token)).toThrow('disk full');
    expect(signCount()).toBe(0);
    expect(loadSession(h.db, token, h.clock)).toBeDefined();
  });
});
