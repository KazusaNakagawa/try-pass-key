import { HealthResponse } from '@app/shared';

async function showHealth(target: HTMLElement): Promise<void> {
  try {
    const res = await fetch('/api/health');
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
