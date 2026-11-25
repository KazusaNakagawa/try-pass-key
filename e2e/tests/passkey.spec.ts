import { expect, test, type CDPSession, type Page } from '@playwright/test';

/**
 * A virtual authenticator replaces Touch ID / a password manager, so the whole
 * flow runs without a person (docs/01 §15.3). It creates real key pairs and
 * signatures; only the user interaction is simulated. With automatic presence,
 * it also answers a Conditional UI request at once, as if the user had picked
 * the passkey from the autofill list.
 */
async function addVirtualAuthenticator(page: Page): Promise<{ cdp: CDPSession; id: string }> {
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

async function register(page: Page, displayName: string): Promise<void> {
  await page.goto('/');
  await page.locator('#display-name').fill(displayName);
  await page.locator('#register-form button[type=submit]').click();
  await expect(page.locator('#register-result')).toContainText('登録しました');
  // Registration also logs in.
  await expect(page.locator('#me')).toContainText(`ログイン中: ${displayName}`);
  // M4: the decoded ceremony is shown, every §6 check passed.
  const inspector = page.locator('#inspector');
  await expect(inspector).toContainText('登録（受理）');
  await expect(inspector).toContainText('C4 ✓');
  await expect(inspector).toContainText('UV=1');
  await expect(inspector).not.toContainText('✗');
  // The manga followed registration to its last panel (docs/05).
  await expect(page.locator('#manga .panel.active')).toHaveAttribute('data-state', 'register:done');
}

test('Conditional UI: after logout, the passkey from autofill logs in again', async ({ page }) => {
  const { cdp, id } = await addVirtualAuthenticator(page);
  await register(page, 'test-user-e2e-1');

  // The credential is discoverable (stored on the authenticator with the user handle).
  const { credentials } = await cdp.send('WebAuthn.getCredentials', { authenticatorId: id });
  expect(credentials).toHaveLength(1);
  expect(credentials[0]?.isResidentCredential).toBe(true);
  const countAtRegistration = credentials[0]?.signCount ?? 0;

  // Logging out restarts the Conditional UI request on the username field.
  await page.locator('#logout').click();
  // toBeVisible: the outcome must be visible to the user, not just present in the DOM.
  await expect(page.locator('#login-result')).toBeVisible();
  await expect(page.locator('#login-result')).toContainText('ログインしました（オートフィル）');
  await expect(page.locator('#me')).toContainText('ログイン中: test-user-e2e-1');

  // The server verified a fresh signature: the authenticator's counter moved on.
  const after = await cdp.send('WebAuthn.getCredentials', { authenticatorId: id });
  expect(after.credentials[0]?.signCount).toBeGreaterThan(countAtRegistration);
});

test('login button: username-less login in a browser without Conditional UI', async ({ page }) => {
  // Simulate a browser without Conditional UI, so only the button can start a login.
  await page.addInitScript(() => {
    PublicKeyCredential.isConditionalMediationAvailable = () => Promise.resolve(false);
  });
  await addVirtualAuthenticator(page);
  await register(page, 'test-user-e2e-2');

  await page.locator('#logout').click();
  await expect(page.locator('#me')).toHaveText('ログインしていません');

  // No name is typed: the authenticator supplies the passkey and its user handle.
  await page.locator('#login-button').click();
  await expect(page.locator('#login-result')).toBeVisible();
  await expect(page.locator('#login-result')).toContainText('ログインしました');
  await expect(page.locator('#me')).toContainText('ログイン中: test-user-e2e-2');
  await expect(page.locator('#inspector')).toContainText('ログイン（受理）');
  await expect(page.locator('#inspector')).toContainText('保存値');
  await expect(page.locator('#manga .panel.active')).toHaveAttribute('data-state', 'login:done');
});

test('transfer: the page steps up with the passkey, then the money moves', async ({ page }) => {
  await addVirtualAuthenticator(page);
  await register(page, 'test-user-e2e-3');

  await expect(page.locator('#transfer-section')).toBeVisible();
  await expect(page.locator('#balance')).toHaveText('100,000');
  await page.locator('#transfer-to').fill('test-account-1');
  await page.locator('#transfer-amount').fill('1000');
  await page.locator('#transfer-form button[type=submit]').click();

  // The first attempt is refused (step_up_required), the passkey approves, the retry goes through.
  await expect(page.locator('#transfer-result')).toContainText('送金しました');
  await expect(page.locator('#balance')).toHaveText('99,000');
  await expect(page.locator('#transfer-history')).toContainText('test-account-1');
  await expect(page.locator('#inspector')).toContainText('ステップアップ（受理）');
  await expect(page.locator('#inspector')).toContainText('S1 ✓');
  await expect(page.locator('#me')).not.toContainText('"stepupAt": null');
  // The manga panel followed the ceremony to the last panel of episode 3 (docs/05).
  await expect(page.locator('#manga .panel.active')).toHaveAttribute('data-state', 'transfer:done');
});

test('episode 4: a transfer with only the session cookie is refused and no money moves', async ({
  page,
}) => {
  await addVirtualAuthenticator(page);
  await register(page, 'test-user-e2e-8');
  await expect(page.locator('#balance')).toHaveText('100,000');

  await page.locator('#attack-button').click();
  await expect(page.locator('#attack-result')).toContainText('step_up_required', {
    timeout: 10_000,
  });
  await expect(page.locator('#manga .panel.active')).toHaveAttribute(
    'data-state',
    'attack:blocked',
  );
  await expect(page.locator('#balance')).toHaveText('100,000');
  await expect(page.locator('#transfer-history')).not.toContainText('test-attacker-account');
});

test('transfer: the form cannot be submitted again while a step-up is running', async ({
  page,
}) => {
  await addVirtualAuthenticator(page);
  await register(page, 'test-user-e2e-4');
  const submit = page.locator('#transfer-form button[type=submit]');
  let disabledDuringStepUp: boolean | undefined;
  await page.route('**/api/stepup/options', async (route) => {
    disabledDuringStepUp = await submit.isDisabled();
    await route.continue();
  });

  await page.locator('#transfer-to').fill('test-account-1');
  await page.locator('#transfer-amount').fill('1000');
  await submit.click();
  await expect(page.locator('#transfer-result')).toContainText('送金しました');
  expect(disabledDuringStepUp).toBe(true);
  await expect(submit).toBeEnabled();
});

test('transfer: the step-up shows in the inspector even if the transfer then fails', async ({
  page,
}) => {
  await addVirtualAuthenticator(page);
  await register(page, 'test-user-e2e-5');
  let transfers = 0;
  await page.route('**/api/transfer', async (route) => {
    transfers++;
    // Let the first attempt reach the server (step_up_required); fail the retry.
    if (transfers === 1) return route.continue();
    return route.fulfill({
      status: 400,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'insufficient_funds', detail: 'simulated' }),
    });
  });

  await page.locator('#transfer-to').fill('test-account-1');
  await page.locator('#transfer-amount').fill('1000');
  await page.locator('#transfer-form button[type=submit]').click();
  await expect(page.locator('#transfer-result')).toContainText('送金できませんでした');
  await expect(page.locator('#inspector')).toContainText('ステップアップ（受理）');
});

test('a failed login message does not linger after registering', async ({ page }) => {
  await addVirtualAuthenticator(page);
  await register(page, 'test-user-e2e-6');
  // Every login is rejected, as for a passkey left over from a deleted database.
  await page.route('**/api/login/verify', (route) =>
    route.fulfill({
      status: 400,
      contentType: 'application/json',
      body: JSON.stringify({
        error: 'unknown_credential',
        detail: 'L1: unknown credential',
        check: 'L1',
      }),
    }),
  );
  await page.locator('#logout').click();
  await expect(page.locator('#login-result')).toContainText('ログインできませんでした');

  await page.locator('#display-name').fill('test-user-e2e-7');
  await page.locator('#register-form button[type=submit]').click();
  await expect(page.locator('#me')).toContainText('ログイン中: test-user-e2e-7');
  await expect(page.locator('#login-result')).toBeHidden();
});

test('passkeys: add a second one behind a step-up, log in with it, delete the first', async ({
  page,
}) => {
  // One virtual authenticator at a time, so which one answers is never a guess.
  const a = await addVirtualAuthenticator(page);
  await register(page, 'test-user-e2e-8');
  const rows = page.locator('#passkey-list li');
  const add = page.locator('#passkey-add');
  const result = page.locator('#passkey-result');
  await expect(rows).toHaveCount(1);
  // The last passkey cannot be deleted.
  await expect(rows.first().locator('button.passkey-delete')).toBeDisabled();

  // A approves the step-up, then refuses to create a second passkey for the same
  // user (excludeCredentials): the approval is kept for a retry.
  await add.click();
  await expect(result).toContainText('パスキーを作成できませんでした');
  await expect(page.locator('#inspector')).toContainText('ステップアップ（受理）');
  let stepups = 0;
  await page.route('**/api/stepup/options', async (route) => {
    stepups++;
    await route.continue();
  });

  // Switch to authenticator B and retry: no second step-up within the approval.
  await a.cdp.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId: a.id });
  const b = await addVirtualAuthenticator(page);
  await add.click();
  await expect(result).toContainText('パスキーを追加しました');
  expect(stepups).toBe(0);
  await expect(rows).toHaveCount(2);
  await expect(page.locator('#inspector')).toContainText('パスキー追加（受理）');
  await expect(page.locator('#inspector')).not.toContainText('✗');
  const onB = await b.cdp.send('WebAuthn.getCredentials', { authenticatorId: b.id });
  expect(onB.credentials).toHaveLength(1);

  // B alone logs in to the same account (Conditional UI answers at once).
  await page.locator('#logout').click();
  await expect(page.locator('#login-result')).toContainText('ログインしました（オートフィル）');
  await expect(page.locator('#me')).toContainText('ログイン中: test-user-e2e-8');

  // Delete A's passkey (the oldest row): B approves the step-up for it.
  await expect(rows).toHaveCount(2);
  await rows.first().locator('button.passkey-delete').click();
  await expect(result).toContainText('パスキーを削除しました');
  await expect(rows).toHaveCount(1);
  await expect(rows.first().locator('button.passkey-delete')).toBeDisabled();
  expect(stepups).toBe(1);
});
