import { startRegistration } from '@simplewebauthn/browser';
import { RegisterOptionsResponse, RegisterVerifyResponse } from '@app/shared';
import { postJson } from './api.js';
import { emitStage } from './stage.js';

/**
 * Registration ceremony (docs/01 §5.1):
 *   1. ask the server for options (it also sets the ceremony cookie)
 *   2. navigator.credentials.create() via @simplewebauthn/browser
 *   3. send the response to the server, which runs the §6 checks
 */
export async function registerPasskey(displayName: string): Promise<RegisterVerifyResponse> {
  emitStage('register:options');
  const options = await postJson('/api/register/options', { displayName }, RegisterOptionsResponse);
  emitStage('register:authenticator');
  const credential = await startRegistration({ optionsJSON: options });
  return postJson('/api/register/verify', credential, RegisterVerifyResponse);
}
