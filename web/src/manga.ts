import { onStage, type PanelState } from './stage.js';

/** Storyboard in docs/05-manga-storyboard.md, drawn as stick figures in SVG. */

type Pose = 'idle' | 'think' | 'ok' | 'ng' | 'scan' | 'run' | 'stop';
type Who = 'pasta' | 'keyko' | 'sabazo' | 'nisera';

const GROUND = 108;

function figure(who: Who, x: number, pose: Pose, flip = false): string {
  const sx = flip ? -1 : 1;
  const armPaths = new Map<Pose, string>(
    Object.entries({
      idle: 'M0 -26 L-9 -14 M0 -26 L9 -14',
      think: 'M0 -26 L-9 -14 M0 -26 L8 -30 L6 -38',
      ok: 'M0 -26 L-11 -42 M0 -26 L11 -42',
      ng: 'M0 -26 L8 -34 M0 -26 L-8 -34 M-8 -34 L8 -26',
      scan: 'M0 -26 L-9 -14 M0 -26 L16 -30',
      run: 'M0 -26 L-10 -20 M0 -26 L10 -32',
      stop: 'M0 -26 L-9 -14 M0 -26 L18 -36',
    }) as [Pose, string][],
  );
  const legs = pose === 'run' ? 'M0 -12 L-9 0 M0 -12 L9 -2' : 'M0 -12 L-6 0 M0 -12 L6 0';
  const eyes =
    who === 'nisera'
      ? '<path d="M-7 -44 h5 M2 -44 h5" />'
      : '<circle cx="-5" cy="-44" r="1.6" class="fill" /><circle cx="5" cy="-44" r="1.6" class="fill" />';
  const mouths = new Map<Pose, string>([
    ['ng', '<path d="M-4 -35 q4 -4 8 0" />'],
    ['ok', '<path d="M-5 -38 q5 6 10 0" />'],
  ]);
  const mouth = mouths.get(pose) ?? '<path d="M-3 -37 h6" />';
  const head =
    who === 'sabazo'
      ? '<rect x="-14" y="-58" width="28" height="28" rx="3" />'
      : '<circle cx="0" cy="-44" r="14" />';
  const extras = new Map<Who, string>([
    [
      'keyko',
      '<text x="-12" y="-54" font-size="12" class="swing">🔑</text><rect x="-5" y="-26" width="10" height="9" rx="1" class="safe" />',
    ],
    ['sabazo', '<rect x="9" y="-26" width="10" height="13" class="note" />'],
    ['nisera', '<path d="M-15 -52 h30" class="mask" />'],
  ]);
  const extra = extras.get(who) ?? '';
  return `<g class="fig ${who} pose-${pose}" transform="translate(${x} ${GROUND}) scale(${sx} 1)">
    <g class="body"><g class="stroke">${head}<path d="M0 -30 L0 -12 ${armPaths.get(pose) ?? ''} ${legs}" />${eyes}${mouth}</g>${extra}</g></g>`;
}

const prop = (emoji: string, x: number, y: number, cls = '', size = 16) =>
  `<text x="${x}" y="${y}" font-size="${size}" class="prop ${cls}">${emoji}</text>`;
const label = (text: string, x: number, y: number, cls = '') =>
  `<text x="${x}" y="${y}" font-size="9" text-anchor="middle" class="label ${cls}">${text}</text>`;

interface Panel {
  state: PanelState;
  caption: string;
  scene: string;
}
interface Episode {
  title: string;
  panels: Panel[];
}

const episodes: Episode[] = [
  {
    title: '第1話 はじめてのパスキー',
    panels: [
      {
        state: 'register:input',
        caption: 'ぱすた「test-user-1 です。口座を作りたいな」',
        scene:
          figure('pasta', 55, 'idle') +
          figure('sabazo', 145, 'idle', true) +
          label('test-user-1', 55, 38, 'plate'),
      },
      {
        state: 'register:options',
        caption: 'サバ蔵「この数字に署名してきて。使えるのは1回だけだよ」',
        scene:
          figure('pasta', 50, 'think') +
          figure('sabazo', 150, 'idle', true) +
          prop('📝', 92, 78, 'fly-left') +
          prop('⏳', 100, 60, 'tick', 14),
      },
      {
        state: 'register:authenticator',
        caption: 'キーこ「本人確認してね」 ぱすた「ピッ（指紋）」',
        scene:
          figure('pasta', 45, 'scan') +
          figure('keyko', 125, 'idle', true) +
          prop('👆', 78, 78, 'tap') +
          prop('🔑', 118, 40, 'pop', 14),
      },
      {
        state: 'register:done',
        caption: 'サバ蔵「公開鍵だけ預かるね」 キーこ「秘密鍵は私の中から出ません」',
        scene:
          figure('pasta', 30, 'ok') +
          figure('keyko', 85, 'ok') +
          figure('sabazo', 160, 'idle', true) +
          prop('🔑', 136, 50, 'pop', 13) +
          prop('🔒', 80, 48, 'pop', 12),
      },
    ],
  },
  {
    title: '第2話 名前を言わなくても入れる',
    panels: [
      {
        state: 'login:idle',
        caption: 'ぱすた「ユーザー名、なんだっけ…」',
        scene:
          figure('pasta', 100, 'think') +
          prop('❓', 118, 54, 'tick') +
          label('［　　　　］', 100, 124, 'plate'),
      },
      {
        state: 'login:options',
        caption: 'サバ蔵「この数字に署名してね」',
        scene:
          figure('pasta', 55, 'idle') +
          figure('sabazo', 150, 'idle', true) +
          prop('📝', 92, 78, 'fly-left'),
      },
      {
        state: 'login:authenticator',
        caption: 'キーこ「どの鍵にする？」 ぱすた「これ！ ピッ」',
        scene:
          figure('pasta', 50, 'scan') +
          figure('keyko', 135, 'idle', true) +
          prop('🔑', 92, 52, 'pop', 12) +
          prop('🔑', 104, 44, 'pop2', 12) +
          prop('🔑', 116, 52, 'pop3', 12),
      },
      {
        state: 'login:done',
        caption: 'サバ蔵「署名OK。ぱすたさんだね」',
        scene:
          figure('pasta', 55, 'ok') +
          figure('sabazo', 150, 'idle', true) +
          prop('🎫', 95, 70, 'fly-right'),
      },
    ],
  },
  {
    title: '第3話 送金の前にもう一度',
    panels: [
      {
        state: 'transfer:submit',
        caption: 'ぱすた「test-account-1 に送るよ」',
        scene:
          figure('pasta', 50, 'run') +
          figure('sabazo', 150, 'idle', true) +
          prop('💴', 92, 78, 'fly-right'),
      },
      {
        state: 'stepup:required',
        caption: 'サバ蔵「待って。ここだけは、もう一度本人確認」（401）',
        scene:
          figure('pasta', 45, 'think') +
          figure('sabazo', 140, 'stop', true) +
          prop('✋', 92, 60, 'pop', 18) +
          label('401', 92, 28, 'alert'),
      },
      {
        state: 'stepup:authenticator',
        caption: 'キーこ「この送金内容に、いま署名したよ」 ぱすた「ピッ」',
        scene:
          figure('pasta', 45, 'scan') +
          figure('keyko', 135, 'idle', true) +
          prop('👆', 78, 78, 'tap') +
          prop('✍️', 112, 50, 'pop', 14) +
          label('→ 送金内容', 112, 30),
      },
      {
        state: 'transfer:done',
        caption: 'サバ蔵「承認は1回きり。送金完了！」',
        scene:
          figure('pasta', 45, 'ok') +
          figure('sabazo', 150, 'idle', true) +
          prop('🎫', 92, 62, 'vanish') +
          prop('💴', 120, 50, 'fly-right'),
      },
    ],
  },
  {
    title: '第4話 盗まれたCookieは通れない（紙芝居）',
    panels: [
      {
        state: 'attack:stolen-cookie',
        caption: 'ニセ太「ふふ、これでぱすたになりすませる」',
        scene:
          figure('pasta', 45, 'idle') +
          figure('nisera', 130, 'run', true) +
          prop('🍪', 76, 90, 'fly-right'),
      },
      {
        state: 'attack:transfer',
        caption: 'ニセ太「100万、僕の口座へ！」',
        scene:
          figure('nisera', 50, 'run') +
          figure('sabazo', 150, 'idle', true) +
          prop('🍪', 92, 78, 'fly-right') +
          label('100万!', 90, 36, 'alert'),
      },
      {
        state: 'attack:stepup-required',
        caption: 'サバ蔵「入館証はOK。でも本人確認の署名がない」（401）',
        scene:
          figure('nisera', 50, 'think') +
          figure('sabazo', 140, 'stop', true) +
          prop('✋', 92, 60, 'pop', 18) +
          label('401', 92, 28, 'alert'),
      },
      {
        state: 'attack:blocked',
        caption: 'ニセ太「鍵が…ない…」 キーこ「秘密鍵は私の中だけだよ」',
        scene:
          figure('nisera', 45, 'ng') +
          prop('❌', 68, 54, 'pop', 16) +
          figure('pasta', 130, 'ok') +
          figure('keyko', 168, 'ok', true),
      },
    ],
  },
];

function panelHtml(panel: Panel, index: number): string {
  return `<li class="panel pending" data-state="${panel.state}">
    <span class="panel-no">${index + 1}</span>
    <svg viewBox="0 0 200 130" role="img" aria-label="${panel.caption}"><line x1="0" x2="200" y1="${GROUND}" y2="${GROUND}" class="ground" />${panel.scene}</svg>
    <p class="bubble">${panel.caption}</p>
    <span class="fail-mark" aria-hidden="true">💦</span>
  </li>`;
}

const root = document.querySelector('#manga');
const tabs = root?.querySelector('.manga-tabs');
const strip = root?.querySelector('.manga-strip');

let current = -1;
/** True while a real ceremony is in progress (from its first stage until done/failed). */
let live = false;
let timer: ReturnType<typeof setTimeout> | undefined;

function panels(): HTMLElement[] {
  return strip ? [...strip.querySelectorAll<HTMLElement>('.panel')] : [];
}

function showEpisode(ep: number): void {
  if (!strip || ep === current) return;
  current = ep;
  strip.innerHTML = (episodes.at(ep)?.panels ?? []).map(panelHtml).join('');
  for (const [i, tab] of [...(tabs?.children ?? [])].entries()) {
    tab.setAttribute('aria-pressed', String(i === ep));
  }
}

/** Marks earlier panels done, this one active (restarting its animation), later ones pending. */
function setStage(stage: PanelState): void {
  const ep = episodes.findIndex((e) => e.panels.some((p) => p.state === stage));
  const episode = episodes.at(ep);
  if (!episode) return;
  showEpisode(ep);
  const idx = episode.panels.findIndex((p) => p.state === stage);
  for (const [i, el] of panels().entries()) {
    el.classList.remove('active', 'done', 'pending', 'failed');
    if (i < idx) el.classList.add('done');
    else if (i > idx) el.classList.add('pending');
    else {
      el.getBoundingClientRect(); // force a reflow to restart the CSS animations
      el.classList.add('active');
    }
  }
}

function failStage(): void {
  if (!live) return; // nothing real is running: don't paint a replayed or finished panel red
  live = false;
  panels()
    .find((el) => el.classList.contains('active'))
    ?.classList.add('failed');
}

function stopPlayback(): void {
  clearTimeout(timer);
  timer = undefined;
}

/** Story-only replay: steps through the panels without touching any ceremony. */
function play(ep: number): void {
  stopPlayback();
  const states = (episodes.at(ep)?.panels ?? []).map((p) => p.state);
  const step = (i: number): void => {
    const state = states.at(i);
    if (state) setStage(state);
    if (i + 1 < states.length)
      timer = setTimeout(() => {
        step(i + 1);
      }, 2200);
  };
  step(0);
}

if (root && tabs && strip) {
  tabs.innerHTML = episodes
    .map((e, i) => `<button type="button" class="manga-tab" data-ep="${i}">${e.title}</button>`)
    .join('');
  tabs.addEventListener('click', (event) => {
    const button = event.target instanceof Element ? event.target.closest('button') : null;
    // Leave the panel alone while a real ceremony is running.
    if (button && !live) {
      current = -1;
      play(Number(button.dataset.ep));
    }
  });
  // A real ceremony takes over from any replay.
  onStage((stage, failed) => {
    stopPlayback();
    if (failed) failStage();
    else if (stage) {
      live = !stage.endsWith(':done');
      setStage(stage);
    }
  });
}
