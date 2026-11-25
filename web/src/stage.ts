/**
 * Tiny event bus between the auth code and the manga panel (docs/05).
 * The auth modules only announce which stage they reached; the panel listens.
 * A listener that throws is ignored, so nothing here can change how a ceremony runs.
 */

/** Stages announced by the auth code. Episode 4 (attack) is story-only and never emitted. */
export type AuthStage =
  | 'register:input'
  | 'register:options'
  | 'register:authenticator'
  | 'register:done'
  | 'login:options'
  | 'login:authenticator'
  | 'login:done'
  | 'transfer:submit'
  | 'stepup:required'
  | 'stepup:authenticator'
  | 'transfer:done';

/** Every panel state: the emitted stages plus the story-only ones. */
export type PanelState =
  | AuthStage
  | 'login:idle'
  | 'attack:stolen-cookie'
  | 'attack:transfer'
  | 'attack:stepup-required'
  | 'attack:blocked';

type Listener = (stage: AuthStage | null, failed: boolean) => void;

const listeners = new Set<Listener>();

export function onStage(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify(stage: AuthStage | null, failed: boolean): void {
  for (const l of listeners) {
    try {
      l(stage, failed);
    } catch (err) {
      console.error('stage listener failed', err);
    }
  }
}

export function emitStage(stage: AuthStage): void {
  notify(stage, false);
}

/** The ceremony behind the current panel failed or was cancelled. */
export function emitStageFailed(): void {
  notify(null, true);
}
