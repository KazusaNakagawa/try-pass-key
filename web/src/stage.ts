/**
 * Tiny event bus between the auth code and the manga panel (docs/05).
 * The auth modules only announce which stage they reached; the panel listens.
 * Nothing here can change how a ceremony runs.
 */
type Listener = (stage: string, failed: boolean) => void;

const listeners = new Set<Listener>();

export function onStage(listener: Listener): void {
  listeners.add(listener);
}

export function emitStage(stage: string): void {
  for (const l of listeners) l(stage, false);
}

/** The ceremony behind the current panel failed or was cancelled. */
export function emitStageFailed(): void {
  for (const l of listeners) l('', true);
}
