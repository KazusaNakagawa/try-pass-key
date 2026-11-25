import {
  HealthResponse,
  MeResponse,
  TransfersResponse,
  type CredentialSummary,
  type CredentialsResponse,
  type StepupVerifyResponse,
} from '@app/shared';
import { aaguidName } from './aaguid-names.js';
import { ApiRequestError, getJson } from './api.js';
import { addPasskey, deletePasskey, loadCredentials } from './credentials.js';
import { showInspection } from './inspector.js';
import { cancelConditionalUI, loginWithPasskey, supportsConditionalUI } from './login.js';
import './manga.js';
import { registerPasskey } from './register.js';
import { emitStage, emitStageFailed } from './stage.js';
import { transferWithStepUp } from './transfer.js';

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
  inspector: $('#inspector', HTMLDivElement),
  transferSection: $('#transfer-section', HTMLElement),
  balance: $('#balance', HTMLSpanElement),
  transferForm: $('#transfer-form', HTMLFormElement),
  transferSubmit: $('#transfer-form button[type=submit]', HTMLButtonElement),
  transferTo: $('#transfer-to', HTMLInputElement),
  transferAmount: $('#transfer-amount', HTMLInputElement),
  transferResult: $('#transfer-result', HTMLPreElement),
  transferHistory: $('#transfer-history', HTMLUListElement),
  passkeySection: $('#passkey-section', HTMLElement),
  passkeyList: $('#passkey-list', HTMLUListElement),
  passkeyAdd: $('#passkey-add', HTMLButtonElement),
  passkeyResult: $('#passkey-result', HTMLPreElement),
};

const yen = (n: number) => n.toLocaleString('ja-JP');

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Shows the rejected ceremony when the server got far enough to inspect it. */
const inspectionOf = (err: unknown) =>
  err instanceof ApiRequestError ? err.body?.inspection : undefined;

/** `refreshLists: false` when the caller has already shown the lists it changed. */
function showMe(me: MeResponse | undefined, { refreshLists = true } = {}): void {
  ui.me.textContent = me
    ? `ログイン中: ${me.displayName}\n${JSON.stringify(me, null, 2)}`
    : 'ログインしていません';
  ui.logout.hidden = !me;
  ui.loginSection.hidden = Boolean(me);
  ui.transferSection.hidden = !me;
  ui.passkeySection.hidden = !me;
  if (me && refreshLists) {
    void refreshTransfers();
    void refreshPasskeys();
  }
}

function showTransfers({ balance, transfers }: TransfersResponse): void {
  ui.balance.textContent = yen(balance);
  ui.transferHistory.replaceChildren(
    ...transfers.map((t) => {
      const li = document.createElement('li');
      li.textContent = `${new Date(t.createdAt).toLocaleString('ja-JP')}  ${t.to}  ${yen(t.amount)}`;
      return li;
    }),
  );
}

async function refreshTransfers(): Promise<void> {
  try {
    showTransfers(await getJson('/api/transfers', TransfersResponse));
  } catch (err) {
    ui.transferResult.textContent = `残高を取得できませんでした\n${message(err)}`;
  }
}

const dateTime = (iso: string | null) => (iso ? new Date(iso).toLocaleString('ja-JP') : '—');

/** One step-up or passkey operation at a time, like the transfer form. */
let passkeyBusy = false;

function setPasskeyBusy(busy: boolean): void {
  passkeyBusy = busy;
  ui.passkeyAdd.disabled = busy;
  for (const button of ui.passkeyList.querySelectorAll('button')) {
    button.disabled = busy || ui.passkeyList.children.length <= 1;
  }
}

function passkeyRow(credential: CredentialSummary, isLast: boolean): HTMLLIElement {
  const li = document.createElement('li');
  li.dataset.credentialId = credential.id;
  const name = aaguidName(credential.aaguid) ?? `AAGUID ${credential.aaguid}`;
  const text = document.createElement('span');
  text.textContent =
    `${name}  作成 ${dateTime(credential.createdAt)}  最終使用 ${dateTime(credential.lastUsedAt)}\n` +
    `BE=${Number(credential.backupEligible)} BS=${Number(credential.backupState)}  ` +
    `${credential.transports.join(', ') || '(transports なし)'}  ID ${credential.id.slice(0, 12)}…`;
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'passkey-delete';
  remove.textContent = '削除';
  // The server refuses too (409); this only saves a pointless step-up.
  remove.disabled = isLast || passkeyBusy;
  remove.addEventListener('click', () => {
    onDeletePasskey(credential.id);
  });
  li.append(text, remove);
  return li;
}

function showPasskeys(list: CredentialsResponse): void {
  const isLast = list.credentials.length <= 1;
  ui.passkeyList.replaceChildren(...list.credentials.map((c) => passkeyRow(c, isLast)));
}

async function refreshPasskeys(): Promise<void> {
  try {
    showPasskeys(await loadCredentials());
  } catch (err) {
    ui.passkeyResult.textContent = `パスキーの一覧を取得できませんでした\n${message(err)}`;
  }
}

const passkeyStepUpHooks = {
  onStepUp: () => {
    ui.passkeyResult.textContent = 'ステップアップが必要です。認証器の操作を待っています...';
    emitStage('stepup:required');
  },
  onApproved: (stepup: StepupVerifyResponse) => {
    showInspection(ui.inspector, stepup.inspection);
  },
};

ui.passkeyAdd.addEventListener('click', () => {
  setPasskeyBusy(true);
  ui.passkeyResult.textContent = 'パスキーを追加しています...';
  addPasskey({
    ...passkeyStepUpHooks,
    onCreating: () => {
      ui.passkeyResult.textContent = '新しいパスキーの作成を待っています...';
    },
  })
    .then((result) => {
      ui.passkeyResult.textContent = `パスキーを追加しました\n${JSON.stringify(result.credential, null, 2)}`;
      showInspection(ui.inspector, result.inspection);
    })
    .catch((err: unknown) => {
      ui.passkeyResult.textContent =
        `パスキーを作成できませんでした\n${message(err)}\n` +
        '承認が残っていれば（承認から4分以内）、もう一度「パスキーを追加」を押すとステップアップなしでやり直せます。' +
        'このユーザーのパスキーがすでにある認証器は選べません。';
      const inspection = inspectionOf(err);
      if (inspection) showInspection(ui.inspector, inspection);
    })
    .finally(async () => {
      // #me shows the new stepupAt; only the passkey list changed.
      await refreshMe({ refreshLists: false });
      await refreshPasskeys();
      setPasskeyBusy(false);
    });
});

function onDeletePasskey(credentialId: string): void {
  setPasskeyBusy(true);
  ui.passkeyResult.textContent = 'パスキーを削除しています...';
  deletePasskey(credentialId, passkeyStepUpHooks)
    .then((list) => {
      ui.passkeyResult.textContent = 'パスキーを削除しました';
      // Already signalled to the authenticator by deletePasskey.
      showPasskeys(list);
    })
    .catch(async (err: unknown) => {
      ui.passkeyResult.textContent = `パスキーを削除できませんでした\n${message(err)}`;
      const inspection = inspectionOf(err);
      if (inspection) showInspection(ui.inspector, inspection);
      await refreshPasskeys();
    })
    .finally(async () => {
      // #me shows the new stepupAt; the list was shown above.
      await refreshMe({ refreshLists: false });
      setPasskeyBusy(false);
    });
}

async function refreshMe(options?: { refreshLists: boolean }): Promise<MeResponse | undefined> {
  const res = await fetch('/api/me');
  const me = res.ok ? MeResponse.parse(await res.json()) : undefined;
  showMe(me, options);
  return me;
}

/** Consecutive Conditional UI failures; stops restarting if something fails instantly. */
let conditionalFailures = 0;
const MAX_CONDITIONAL_RESTARTS = 3;

/** Waits for the user to pick a passkey from the username field's autofill. */
async function startConditionalUI(): Promise<void> {
  if (!(await supportsConditionalUI())) return;
  try {
    const result = await loginWithPasskey(true);
    conditionalFailures = 0;
    ui.loginResult.textContent = `ログインしました（オートフィル）\n${JSON.stringify(result, null, 2)}`;
    showInspection(ui.inspector, result.inspection);
    emitStage('login:done');
    showMe(result.me);
  } catch (err) {
    // AbortError: another ceremony replaced this one. Not worth showing.
    if (err instanceof Error && err.name === 'AbortError') return;
    ui.loginResult.textContent = `ログインできませんでした\n${message(err)}`;
    showInspection(ui.inspector, inspectionOf(err));
    restartConditionalUI();
  }
}

/** Offers passkeys in the username field again after a failed or cancelled login. */
function restartConditionalUI(): void {
  conditionalFailures++;
  if (conditionalFailures > MAX_CONDITIONAL_RESTARTS) return;
  void startConditionalUI();
}

ui.loginButton.addEventListener('click', () => {
  ui.loginResult.textContent = '認証器の操作を待っています...';
  cancelConditionalUI()
    .then(() => loginWithPasskey())
    .then((result) => {
      conditionalFailures = 0;
      ui.loginResult.textContent = `ログインしました\n${JSON.stringify(result, null, 2)}`;
      showInspection(ui.inspector, result.inspection);
      emitStage('login:done');
      showMe(result.me);
    })
    .catch((err: unknown) => {
      ui.loginResult.textContent = `ログインできませんでした\n${message(err)}`;
      emitStageFailed();
      showInspection(ui.inspector, inspectionOf(err));
      // Dismissing the passkey sheet or a server rejection: offer autofill again.
      restartConditionalUI();
    });
});

ui.registerForm.addEventListener('submit', (event) => {
  event.preventDefault();
  ui.registerResult.textContent = '認証器の操作を待っています...';
  cancelConditionalUI()
    .then(() => registerPasskey(ui.displayName.value))
    .then(async (result) => {
      // Now logged in: an earlier failed login (e.g. with a passkey left over from
      // a deleted database) is no longer the state of the page.
      ui.loginResult.textContent = '';
      ui.registerResult.textContent = `登録しました\n${JSON.stringify(result, null, 2)}`;
      emitStage('register:done');
      showInspection(ui.inspector, result.inspection);
      await refreshMe();
    })
    .catch((err: unknown) => {
      ui.registerResult.textContent = `登録できませんでした\n${message(err)}`;
      emitStageFailed();
      showInspection(ui.inspector, inspectionOf(err));
      restartConditionalUI();
    });
});

ui.transferForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const tx = { to: ui.transferTo.value, amount: Number(ui.transferAmount.value) };
  // One transfer at a time: a second submit would start a second step-up whose
  // ceremony aborts the first and whose session rotation races it.
  ui.transferSubmit.disabled = true;
  ui.transferResult.textContent = '送金しています...';
  emitStage('transfer:submit');
  transferWithStepUp(tx, {
    onStepUp: () => {
      ui.transferResult.textContent = 'ステップアップが必要です。認証器の操作を待っています...';
      emitStage('stepup:required');
    },
    onApproved: (stepup) => {
      showInspection(ui.inspector, stepup.inspection);
    },
  })
    .then(async (result) => {
      ui.transferResult.textContent = `送金しました\n${JSON.stringify(result, null, 2)}`;
      emitStage('transfer:done');
      await refreshMe();
    })
    .catch(async (err: unknown) => {
      ui.transferResult.textContent = `送金できませんでした\n${message(err)}`;
      emitStageFailed();
      // A rejected step-up carries its inspection; a failed transfer does not.
      const inspection = inspectionOf(err);
      if (inspection) showInspection(ui.inspector, inspection);
      await refreshMe();
    })
    .finally(() => {
      ui.transferSubmit.disabled = false;
    });
});

ui.logout.addEventListener('click', () => {
  void fetch('/api/logout', { method: 'POST' }).then(async () => {
    ui.loginResult.textContent = '';
    ui.transferResult.textContent = '';
    ui.passkeyResult.textContent = '';
    conditionalFailures = 0;
    await refreshMe();
    emitStage('register:input');
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
  if (me) {
    emitStage('login:done');
  } else {
    emitStage('register:input');
    void startConditionalUI();
  }
});
