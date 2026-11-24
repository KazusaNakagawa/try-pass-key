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
});
