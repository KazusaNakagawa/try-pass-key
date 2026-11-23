import { HealthResponse } from '@app/shared';

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

const target = document.querySelector<HTMLElement>('#health');
if (target) {
  void showHealth(target);
}
