import { expect, test, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OUT = '/app/.local-docs/playwright-capture/output';
mkdirSync(`${OUT}/shots`, { recursive: true });

// Captures for the book. Same virtual authenticator as e2e/tests/passkey.spec.ts.
async function addVirtualAuthenticator(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  return { cdp, id: authenticatorId };
}

// Clips for capture.sh to cut GIFs from: each clip names its video and its
// start and end in seconds from the start of that video. All tests run in one
// worker, so one map collects every clip.
interface Clip {
  video: string;
  start?: number;
  end?: number;
}
let t0 = 0;
let video = '';
const clips = new Map<string, Clip>();
function mark(name: string, edge: 'start' | 'end') {
  const clip = clips.get(name) ?? { video };
  const at = (Date.now() - t0) / 1000;
  if (edge === 'start') clip.start = at;
  else clip.end = at;
  clips.set(name, clip);
  writeFileSync(`${OUT}/marks.json`, JSON.stringify(Object.fromEntries(clips), null, 2));
}
// Using `page` here creates it, and starts its video, right before t0. Without
// it the page would only be created in the test body, after t0.
test.beforeEach(({ page }, testInfo) => {
  expect(page.url()).toBe('about:blank');
  t0 = Date.now();
  video = join(testInfo.outputDir, 'video.webm');
});

async function top(page: Page, sel: string) {
  await page.locator(sel).evaluate((el) => {
    el.scrollIntoView({ block: 'start' });
  });
}
async function shot(page: Page, sel: string, name: string) {
  await page.locator(sel).screenshot({ path: `${OUT}/shots/${name}.png` });
}

// A pause for whoever watches the recording, not a synchronization: every step
// still waits on an observable condition before the pause.
async function pause(page: Page, ms: number) {
  // eslint-disable-next-line sonarjs/no-fixed-wait-in-tests -- pause for the recording, see above
  await page.waitForTimeout(ms);
}

async function register(page: Page, name: string) {
  await page.goto('/');
  await page.locator('#display-name').fill(name);
  await page.locator('#register-form button[type=submit]').click();
  await expect(page.locator('#register-result')).toContainText('登録しました');
}

test('register and login', async ({ page }) => {
  await addVirtualAuthenticator(page);
  await page.goto('/');
  await pause(page, 600);
  mark('register', 'start');
  await page.locator('#display-name').fill('test-user-1');
  await page.locator('#register-form button[type=submit]').click();
  await expect(page.locator('#register-result')).toContainText('登録しました');
  await pause(page, 1500);
  mark('register', 'end');
  await top(page, '#inspector-section');
  await shot(page, '#inspector-section', 'inspector-register');
  await top(page, '#session-section');
  await pause(page, 600);
  mark('login', 'start');
  await page.locator('#logout').click();
  await expect(page.locator('#login-result')).toContainText('ログインしました（オートフィル）');
  await pause(page, 1500);
  mark('login', 'end');
  await shot(page, '#session-section', 'session-after-login');
});

test('transfer with step-up', async ({ page }) => {
  await addVirtualAuthenticator(page);
  await register(page, 'test-user-2');
  await top(page, '#transfer-section');
  await pause(page, 600);
  mark('transfer', 'start');
  await page.locator('#transfer-to').fill('test-account-1');
  await page.locator('#transfer-amount').fill('1000');
  await page.locator('#transfer-form button[type=submit]').click();
  await expect(page.locator('#transfer-result')).toContainText('送金しました');
  await pause(page, 1500);
  mark('transfer', 'end');
  await shot(page, '#transfer-section', 'transfer-done');
  await top(page, '#inspector-section');
  await shot(page, '#inspector-section', 'inspector-stepup');
});

test('add a second passkey', async ({ page }) => {
  const a = await addVirtualAuthenticator(page);
  await register(page, 'test-user-3');
  // A approves the step-up but refuses a second passkey for the same user
  // (excludeCredentials); the approval is kept, so B creates it on the retry.
  await page.locator('#passkey-add').click();
  await expect(page.locator('#passkey-result')).toContainText('パスキーを作成できませんでした');
  await a.cdp.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId: a.id });
  await addVirtualAuthenticator(page);
  await top(page, '#passkey-section');
  await pause(page, 600);
  await page.locator('#passkey-add').click();
  await expect(page.locator('#passkey-result')).toContainText('パスキーを追加しました');
  await expect(page.locator('#passkey-list li')).toHaveCount(2);
  await pause(page, 1500);
  await shot(page, '#passkey-section', 'passkey-list-two');
});
