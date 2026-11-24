/**
 * Names for a few common authenticators, so the passkey list can tell them
 * apart. Checked against the public passkey AAGUID list (passkeydeveloper /
 * passkey-authenticator-aaguids, aaguid.json) on 2026-11-24. Anything else is
 * shown as its AAGUID.
 */
const NAMES: ReadonlyMap<string, string> = new Map([
  ['bada5566-a7aa-401f-bd96-45619a55120d', '1Password'],
  ['fbfc3007-154e-4ecc-8c0b-6e020557d7bd', 'Apple Passwords（iCloud キーチェーン）'],
  ['dd4ec289-e01d-41c9-bb89-70fa845d4bf2', 'iCloud Keychain (Managed)'],
  ['ea9b8d66-4d01-1d21-3ce4-b6b48cb575d4', 'Google パスワードマネージャー'],
  ['adce0002-35bc-c60a-648b-0b25f1f05503', 'Chrome on Mac'],
  ['08987058-cadc-4b81-b6e1-30de50dcbe96', 'Windows Hello'],
  ['9ddd1817-af5a-4672-a2b9-3e3dd95000a9', 'Windows Hello'],
  ['6028b017-b1d4-4c02-b4b3-afcdafc96bb2', 'Windows Hello'],
  ['531126d6-e717-415c-9320-3d9aa6981239', 'Dashlane'],
  ['d548826e-79b4-db40-a3d8-11116f7e8349', 'Bitwarden'],
]);

export function aaguidName(aaguid: string): string | undefined {
  return NAMES.get(aaguid);
}
