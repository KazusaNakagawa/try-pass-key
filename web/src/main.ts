import { HealthResponse } from '@app/shared';
import { registerPasskey } from './register.js';

async function showHealth(target: HTMLElement): Promise<void> {
  try {
    const res = await fetch('/api/health');
    // While the server restarts, the Vite proxy answers 502/504 with a non-JSON body.
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText}`);
    }
    const body = HealthResponse.parse(await res.json());
    target.textContent = JSON.stringify(body, null, 2);
  } catch (err) {
    target.textContent = `取得できませんでした: ${String(err)}`;
  }
}

function setupRegistration(form: HTMLFormElement, input: HTMLInputElement, out: HTMLElement) {
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    out.textContent = '認証器の操作を待っています...';
    registerPasskey(input.value)
      .then((result) => {
        out.textContent = `登録しました\n${JSON.stringify(result, null, 2)}`;
      })
      .catch((err: unknown) => {
        out.textContent = `登録できませんでした\n${err instanceof Error ? err.message : String(err)}`;
      });
  });
}

const health = document.querySelector<HTMLElement>('#health');
if (health) void showHealth(health);

const form = document.querySelector<HTMLFormElement>('#register-form');
const input = document.querySelector<HTMLInputElement>('#display-name');
const out = document.querySelector<HTMLElement>('#register-result');
if (form && input && out) setupRegistration(form, input, out);
