import { HealthResponse, MeResponse } from '@app/shared';
import { cancelConditionalUI, loginWithPasskey, supportsConditionalUI } from './login.js';
import { registerPasskey } from './register.js';

/** Looks up a required element and checks its type at runtime. */
function $<T extends HTMLElement>(selector: string, type: new () => T): T {
  const el = document.querySelector(selector);
  if (!(el instanceof type)) throw new Error(`missing element ${selector}`);
  return el;
}

const ui = {
  me: $('#me', HTMLPreElement),
  logout: $('#logout', HTMLButtonElement),
  loginSection: $('#login-section', HTMLElement),
  loginButton: $('#login-button', HTMLButtonElement),
  loginResult: $('#login-result', HTMLPreElement),
  registerForm: $('#register-form', HTMLFormElement),
  displayName: $('#display-name', HTMLInputElement),
  registerResult: $('#register-result', HTMLPreElement),
  health: $('#health', HTMLPreElement),
};

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

function showMe(me: MeResponse | undefined): void {
  ui.me.textContent = me
    ? `ログイン中: ${me.displayName}\n${JSON.stringify(me, null, 2)}`
    : 'ログインしていません';
  ui.logout.hidden = !me;
  ui.loginSection.hidden = Boolean(me);
}

async function refreshMe(): Promise<MeResponse | undefined> {
  const res = await fetch('/api/me');
  const me = res.ok ? MeResponse.parse(await res.json()) : undefined;
  showMe(me);
  return me;
}

/** Waits for the user to pick a passkey from the username field's autofill. */
async function startConditionalUI(): Promise<void> {
  if (!(await supportsConditionalUI())) return;
  try {
    const result = await loginWithPasskey(true);
    ui.loginResult.textContent = `ログインしました（オートフィル）\n${JSON.stringify(result, null, 2)}`;
    showMe(result.me);
  } catch (err) {
    // AbortError: another ceremony replaced this one. Not worth showing.
    if (err instanceof Error && err.name === 'AbortError') return;
    ui.loginResult.textContent = `ログインできませんでした\n${message(err)}`;
  }
}

ui.loginButton.addEventListener('click', () => {
  cancelConditionalUI();
  ui.loginResult.textContent = '認証器の操作を待っています...';
  loginWithPasskey()
    .then((result) => {
      ui.loginResult.textContent = `ログインしました\n${JSON.stringify(result, null, 2)}`;
      showMe(result.me);
    })
    .catch((err: unknown) => {
      ui.loginResult.textContent = `ログインできませんでした\n${message(err)}`;
    });
});

ui.registerForm.addEventListener('submit', (event) => {
  event.preventDefault();
  cancelConditionalUI();
  ui.registerResult.textContent = '認証器の操作を待っています...';
  registerPasskey(ui.displayName.value)
    .then(async (result) => {
      ui.registerResult.textContent = `登録しました\n${JSON.stringify(result, null, 2)}`;
      await refreshMe();
    })
    .catch((err: unknown) => {
      ui.registerResult.textContent = `登録できませんでした\n${message(err)}`;
      void startConditionalUI();
    });
});

ui.logout.addEventListener('click', () => {
  void fetch('/api/logout', { method: 'POST' }).then(async () => {
    ui.loginResult.textContent = '';
    await refreshMe();
    void startConditionalUI();
  });
});

async function showHealth(): Promise<void> {
  try {
    const res = await fetch('/api/health');
    // While the server restarts, the Vite proxy answers 502/504 with a non-JSON body.
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    ui.health.textContent = JSON.stringify(HealthResponse.parse(await res.json()), null, 2);
  } catch (err) {
    ui.health.textContent = `取得できませんでした: ${message(err)}`;
  }
}

void showHealth();
void refreshMe().then((me) => {
  if (!me) void startConditionalUI();
});
