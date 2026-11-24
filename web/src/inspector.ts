import type { CeremonyInspection } from '@app/shared';

/**
 * Renders the inspection of the last ceremony (M4): what the browser and the
 * authenticator sent, what the server expected, and how far the docs/01 §6
 * checks got. Every value comes from the browser or the authenticator, so the
 * DOM is built with textContent only.
 */
export function showInspection(target: HTMLElement, inspection: CeremonyInspection | undefined) {
  const section = target.closest('section');
  if (!inspection) {
    // The latest attempt never reached the checks (cancelled, malformed request,
    // network error). Do not leave an older ceremony looking like the latest one.
    if (section && !section.hidden) {
      target.replaceChildren(
        el('p', '直前の操作はサーバーの検証まで届かなかったため、表示する内容がありません。'),
      );
    }
    return;
  }
  if (section) section.hidden = false;
  target.replaceChildren(
    heading(inspection),
    checkRow(inspection),
    ...(inspection.failure ? [el('p', inspection.failure.message, 'inspector-failure')] : []),
    comparison(inspection),
    authenticatorSummary(inspection),
    el('pre', inspection.clientData.json),
  );
}

function el(tag: string, text: string, className?: string): HTMLElement {
  const node = document.createElement(tag);
  node.textContent = text;
  if (className) node.className = className;
  return node;
}

function heading(i: CeremonyInspection): HTMLElement {
  const name = i.ceremony === 'register' ? '登録' : 'ログイン';
  const f = i.failure;
  let outcome = '受理';
  if (f?.kind === 'check') outcome = `拒否: ${f.check ?? '?'}`;
  // A decode error surfaces inside the first check that reads the data; it is not that check's verdict.
  else if (f) outcome = f.check ? `拒否: 形式エラー（${f.check} の実行中）` : '拒否: 形式エラー';
  return el('p', `${name}（${outcome}）`, 'inspector-heading');
}

const MARK = { pass: '✓', fail: '✗', not_run: '-' } as const;

function checkRow(i: CeremonyInspection): HTMLElement {
  const row = el('p', '検証 ', 'inspector-checks');
  for (const c of i.checks) {
    row.append(el('span', `${c.id} ${MARK[c.result]}`, `check-${c.result}`), ' ');
  }
  return row;
}

const NOT_DECODED = '（C2 より前で止まったため未デコード）';

function comparison(i: CeremonyInspection): HTMLElement {
  const table = document.createElement('table');
  const head = table.createTHead().insertRow();
  for (const label of ['', '期待値', '実際']) head.append(el('th', label));
  const body = table.createTBody();
  const actualHash = actualRpIdHash(i.authenticatorData);
  const rows: [string, string, string][] = [
    ['type', i.expected.type, i.clientData.type],
    ['origin', i.expected.origin, i.clientData.origin],
    ['rpIdHash', i.expected.rpIdHash, actualHash],
  ];
  for (const [label, expected, actual] of rows) {
    const tr = body.insertRow();
    tr.append(el('th', label), el('td', expected));
    tr.append(el('td', actual, expected === actual ? undefined : 'mismatch'));
  }
  return table;
}

function actualRpIdHash(data: CeremonyInspection['authenticatorData']): string {
  if (!data) return NOT_DECODED;
  return 'error' in data ? '（デコード失敗）' : data.rpIdHash;
}

function authenticatorSummary(i: CeremonyInspection): HTMLElement {
  const data = i.authenticatorData;
  if (!data) return el('p', `authenticatorData: ${NOT_DECODED}`);
  if ('error' in data) return el('p', `authenticatorData: ${data.error}`, 'inspector-failure');
  const bit = (b: boolean) => (b ? '1' : '0');
  const { up, uv, be, bs, at, ed } = data.flags;
  const lines = [
    `flags: UP=${bit(up)} UV=${bit(uv)} BE=${bit(be)} BS=${bit(bs)} AT=${bit(at)} ED=${bit(ed)}`,
    `signCount: ${String(data.signCount)}${
      i.storedCredential ? `（保存値 ${String(i.storedCredential.signCount)}）` : ''
    }`,
  ];
  if (i.storedCredential) {
    lines.push(
      `保存済みの BE/BS: ${bit(i.storedCredential.backupEligible)}/${bit(i.storedCredential.backupState)}`,
    );
  }
  if (data.aaguid) lines.push(`AAGUID: ${data.aaguid}`);
  if (data.credentialId) lines.push(`credential ID: ${data.credentialId}`);
  return el('pre', lines.join('\n'));
}
