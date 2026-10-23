// The screen kids see: big buttons, push-to-talk, and pictures.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Text, useApp, useInput, useWindowSize } from 'ink';
import htm from 'htm';
import { createSession } from './session.mjs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { text as label, pickChoices, fill, loadSettings, saveSettings } from './config.mjs';
import { abilities, startRecording, transcribe, speak, hush, guessLang, warmUp } from './voice.mjs';
import { render as renderPicture } from './pictures.mjs';
import { describe, peek } from './files.mjs';
import { openPanel, resizePanel, pressKey, escapePanel, usePanel, TerminalView } from './panel.mjs';

const html = htm.bind(React.createElement);

const WORDS = {
  hello: { en: 'Hi! What do you want to do?', da: 'Hej! Hvad vil du lave?' },
  pick: { en: 'Which one?', da: 'Hvilken en?' },
  buttons: { en: 'buttons', da: 'knapper' },
  stopped: { en: 'It stopped. Press ENTER to start it again.', da: 'Den er stoppet. Tryk ENTER for at starte den igen.' },
  tell: { en: 'Tell me about it! Press space and talk.', da: 'Fortæl mig om det! Tryk på mellemrum og snak.' },
  right: { en: 'Is that right?', da: 'Er det rigtigt?' },
  yes: { en: 'Yes!', da: 'Ja!' },
  no: { en: 'No', da: 'Nej' },
  talk: { en: 'talk', da: 'snak' },
  listening: { en: 'I am listening…', da: 'Jeg lytter…' },
  stopTalk: { en: 'Press SPACE when you are done', da: 'Tryk MELLEMRUM når du er færdig' },
  done: { en: 'done', da: 'færdig' },
  choose: { en: 'choose', da: 'vælg' },
  send: { en: 'send', da: 'send' },
  hearing: { en: 'Let me hear…', da: 'Lad mig høre…' },
  type: { en: 'type', da: 'skriv' },
  back: { en: 'back', da: 'tilbage' },
  quit: { en: 'quit', da: 'slut' },
  working: { en: 'Working on it', da: 'Jeg arbejder på det' },
  yourFiles: { en: 'Files', da: 'Filer' },
  newFile: { en: 'new', da: 'ny' },
  changedFile: { en: 'changed', da: 'ændret' },
  read: { en: 'Looking at', da: 'Kigger i' },
  write: { en: 'Making', da: 'Laver' },
  edit: { en: 'Changing', da: 'Ændrer' },
  draw: { en: 'Drawing', da: 'Tegner' },
  more: { en: 'Want to change something? Press space and talk.', da: 'Vil du lave noget om? Tryk mellemrum og snak.' },
  fun: { en: 'Have fun!', da: 'God fornøjelse!' },
  again: { en: "I didn't hear anything. Press space and try again!", da: 'Jeg hørte ikke noget. Tryk mellemrum og prøv igen!' },
  noMic: { en: 'No microphone helper here, so press T and type.', da: 'Mikrofonen virker ikke her, så tryk T og skriv.' },
};

const LANGUAGES = [
  { id: 'da', flag: '🇩🇰', name: 'Dansk', say: 'Nu taler jeg dansk!' },
  { id: 'en', flag: '🇬🇧', name: 'English', say: 'Now I speak English!' },
  { id: 'auto', flag: '🌍', name: 'Auto', say: { en: 'I will speak the language you speak!', da: 'Jeg taler det sprog, du taler!' } },
];

function systemLang() {
  const loc = Intl.DateTimeFormat().resolvedOptions().locale ?? '';
  return loc.startsWith('da') ? 'da' : 'en';
}

export function App({ cwd, config, quiet = false }) {
  const { exit } = useApp();
  const { columns, rows } = useWindowSize();
  const [can] = useState(abilities); // runs shell checks: once, not on every render
  const canTalk = can.record && can.transcribe;

  // "da", "en" or "auto". Chosen with L inside Kidex; otherwise kidex.json decides.
  const [language, setLanguage] = useState(() => loadSettings().language ?? config.language);
  const [lang, setLang] = useState(() => language === 'auto' ? systemLang() : language); // the language spoken right now
  const w = key => label(WORDS[key], lang);

  function nextLanguage() {
    const next = LANGUAGES[(LANGUAGES.findIndex(l => l.id === language) + 1) % LANGUAGES.length];
    setLanguage(next.id);
    saveSettings({ language: next.id });
    const now = next.id === 'auto' ? langRef.current : next.id;
    setLang(now); langRef.current = now;
    hush();
    if (!quiet) speak(label(next.say, now), { lang: now, voices: config.voices });
  }

  const [screen, setScreen] = useState('home');
  const [sel, setSel] = useState(0);
  const [action, setAction] = useState(null);
  const [picks, setPicks] = useState([]);
  const [pick, setPick] = useState(null);

  const [lines, setLines] = useState([]);
  const [prompt, setPrompt] = useState(null); // {kind: 'first'|'ask'|'plan'|'done'|'free', choices?, pictures?}
  const [busy, setBusy] = useState(false);
  const [activity, setActivity] = useState(null);
  const [drawn, setDrawn] = useState([]); // pictures Claude drew this session, shown while it works
  const [files, setFiles] = useState({}); // file → {isNew, t}: what Claude made or changed this session
  const [now, setNow] = useState(null); // {action, file, content}: the file Claude is working on
  const [ear, setEar] = useState('idle'); // idle | recording | hearing
  const [typing, setTyping] = useState(null);
  const [cost, setCost] = useState(0);
  const [tick, setTick] = useState(0);
  const [onPanel, setOnPanel] = useState(false); // keys go to the panel's program, not the buttons

  const session = useRef(null);
  const recording = useRef(null);
  const langRef = useRef(lang);
  langRef.current = lang;

  // The animation clock only runs while something moves, so menus don't redraw for nothing.
  const animating = busy || ear !== 'idle' || typing !== null;
  useEffect(() => {
    if (!animating) return;
    const t = setInterval(() => setTick(n => n + 1), 300);
    return () => clearInterval(t);
  }, [animating]);

  // Load the voice for the current language now, so the first sentence isn't slow.
  useEffect(() => { if (!quiet) warmUp(lang, config.voices); }, [lang]);

  const say = (who, text) => setLines(l => [...l.slice(-30), { who, text }]);
  const voice = text => { if (!quiet) speak(text, { lang: langRef.current, voices: config.voices }); };

  function onEvent(e) {
    switch (e.type) {
      case 'speak':
        say('kidex', e.text); voice(e.text); break;
      case 'ask':
        say('kidex', e.question); voice(e.question);
        setPrompt({ kind: 'ask', choices: e.choices }); setSel(0); setBusy(false); break;
      case 'plan':
        say('kidex', e.summary); voice(`${e.summary} ${w('right')}`);
        setPrompt({ kind: 'plan', choices: [`👍 ${w('yes')}`, `👎 ${w('no')}`] }); setSel(0); setBusy(false); break;
      case 'activity':
        setActivity(e); break;
      case 'file':
        setNow(e);
        if (e.action !== 'read') setFiles(f => ({ ...f, [e.file]: { isNew: f[e.file]?.isNew ?? e.isNew, t: Date.now() } }));
        break;
      case 'files':
        setFiles(f => {
          const next = { ...f };
          for (const x of e.files) if (!next[x.file]) next[x.file] = { isNew: x.isNew, t: Date.now() };
          return next;
        });
        break;
      case 'picture':
        setDrawn(d => [...d.filter(f => f !== e.file), e.file].slice(-3)); break;
      case 'blocked':
        break; // the guard's notes are for grown-ups, not the kids
      case 'done':
        say('kidex', e.summary); voice(e.summary);
        setPrompt({ kind: 'done', pictures: e.pictures }); setBusy(false); break;
      case 'error':
        say('error', e.message); setBusy(false); setPrompt(p => p ?? { kind: 'free' }); break;
      case 'turn':
        setCost(e.cost ?? 0); setBusy(false); setPrompt(p => p ?? { kind: 'free' }); break;
    }
  }

  function begin(a, p) {
    if (a.run) {
      // A plain command, no Claude: like opening a toy to play with it.
      spawn(fill(a.run, { pick: p }), { cwd, shell: true, stdio: 'ignore', detached: true }).unref();
      voice(w('fun'));
      setScreen('home'); setSel(0);
      return;
    }
    if (a.panel) {
      // A program that keeps running, like a dev screen: it fills the screen, the buttons move to the left.
      openPanel(fill(a.panel, { pick: p }), { cwd, title: `${a.emoji} ${label(a.label, lang)}`, cols: columns - COLUMN - 2, rows: rows - 4 });
      setScreen('home'); setSel(config.actions.indexOf(a)); setOnPanel(true);
      return;
    }
    setAction(a); setPick(p); setLines([]); setDrawn([]); setFiles({}); setNow(null); setScreen('chat');
    setPrompt({ kind: 'first' });
    session.current = createSession({ cwd, config: { ...config, language }, onEvent });
    say('kidex', w('tell')); voice(w('tell'));
  }

  function submit(words) {
    words = words.trim();
    if (!words) return;
    hush();
    const l = language === 'auto' ? guessLang(words, langRef.current) : language;
    setLang(l); langRef.current = l;
    say('kid', words);
    const was = prompt;
    setPrompt(null); setBusy(true); setActivity(null);
    if (was?.kind === 'first') session.current.start({ action, pick, words, lang: l });
    else if (was?.kind === 'plan' && (words === was.choices[0] || words === was.choices[1])) session.current.answer(words.slice(0, 2));
    else session.current.answer(words);
  }

  async function toggleMic() {
    if (!canTalk) { say('error', w('noMic')); return; }
    if (ear === 'idle') {
      hush();
      try { recording.current = startRecording(); setEar('recording'); } catch (e) { say('error', e.message); }
      return;
    }
    if (ear !== 'recording') return;
    setEar('hearing');
    try {
      const file = await recording.current.stop();
      const heard = await transcribe(file, language);
      setEar('idle');
      if (heard) submit(heard);
      else { say('kidex', w('again')); voice(w('again')); }
    } catch (e) {
      setEar('idle'); say('error', e.message);
    }
  }

  async function home() {
    hush();
    recording.current?.cancel?.(); setEar('idle');
    await session.current?.stop();
    session.current = null;
    setScreen('home'); setSel(0); setPrompt(null); setBusy(false); setActivity(null); setOnPanel(false);
  }

  const choices = screen === 'home' ? config.actions.map(a => `${a.emoji} ${label(a.label, lang)}`)
    : screen === 'pick' ? picks
    : prompt?.choices ?? [];

  // While building, wide screens show what happens to the files on the right.
  const showPanel = screen === 'chat' && columns >= 100 && Object.keys(files).length + (now ? 1 : 0) > 0;
  const mainWidth = showPanel ? columns - PANEL : columns;

  // With a panel program running, the start screen is that program, with the buttons in a column on the left.
  const panel = usePanel();
  const split = screen === 'home' && panel !== null;
  const toPanel = split && onPanel && panel.code === null;
  useEffect(() => resizePanel(columns - COLUMN - 2, rows - 4), [columns, rows]);

  useInput((input, key) => {
    if (typing !== null) {
      if (key.return) { const t = typing; setTyping(null); submit(t); }
      else if (key.escape) setTyping(null);
      else if (key.backspace || key.delete) setTyping(t => t.slice(0, -1));
      else if (input && !key.ctrl && !key.meta) setTyping(t => t + input);
      return;
    }
    if (toPanel) { if (key.escape) escapePanel(() => setOnPanel(false)); else pressKey(input, key); return; }
    if (split && key.tab) { setOnPanel(true); return; }
    if (key.escape) { if (screen !== 'home') home(); return; }
    if ((input === 'l' || input === 'L') && ear === 'idle') { nextLanguage(); return; }
    if (screen === 'home' && input === 'q') { exit(); return; }

    const n = choices.length;
    // Tiles sit in a grid: left/right move one, up/down a whole row.
    const row = split ? 1 : perRowFor(n, mainWidth, screen === 'pick');
    if (n && key.rightArrow) { setSel(s => (s + 1) % n); return; }
    if (n && key.leftArrow) { setSel(s => (s - 1 + n) % n); return; }
    if (n && key.downArrow) { setSel(s => (s + row < n ? s + row : s % row)); return; }
    if (n && key.upArrow) { setSel(s => (s - row >= 0 ? s - row : Math.min(n - 1, s + row * Math.floor((n - 1 - s) / row)))); return; }
    const digit = Number(input);
    const chosen = key.return ? sel : digit >= 1 && digit <= n ? digit - 1 : null;

    if (screen === 'home' && chosen != null) {
      const a = config.actions[chosen];
      if (a.pick) {
        const list = pickChoices(cwd, a.pick);
        setAction(a); setPicks(list); setSel(0); setScreen('pick'); voice(w('pick'));
      } else begin(a, null);
      return;
    }
    if (screen === 'pick' && chosen != null && picks[chosen]) { begin(action, picks[chosen]); return; }

    if (screen === 'chat') {
      if (input === ' ' && !busy || input === ' ' && ear !== 'idle') { toggleMic(); return; }
      if ((input === 't' || input === 'T') && !busy && ear === 'idle') { setTyping(''); return; }
      if (chosen != null && choices[chosen] && !busy && ear === 'idle') { submit(choices[chosen]); return; }
      if (prompt?.kind === 'plan' && (input === 'y' || input === 'j')) { submit(choices[0]); return; }
      if (prompt?.kind === 'plan' && input === 'n') { submit(choices[1]); return; }
    }
  });


  const lastKidex = [...lines].reverse().find(l => l.who === 'kidex' || l.who === 'error');
  const lastKid = [...lines].reverse().find(l => l.who === 'kid');
  const flag = LANGUAGES.find(l => l.id === language) ?? LANGUAGES[2];

  let middle;
  if (split) {
    middle = html`<${Column} items=${config.actions.map(a => ({ emoji: a.emoji, text: label(a.label, lang) }))} sel=${toPanel ? -1 : sel} />`;
  } else if (screen === 'home') {
    middle = html`<${Box} flexDirection="column" alignItems="center">
      <${Title}>${w('hello')}<//>
      <${Tiles} items=${config.actions.map(a => ({ emoji: a.emoji, text: label(a.label, lang) }))} sel=${sel} columns=${mainWidth} /><//>`;
  } else if (screen === 'pick') {
    middle = html`<${Box} flexDirection="column" alignItems="center">
      <${Title}>${w('pick')}<//>
      <${Tiles} items=${picks.map(p => ({ emoji: '🧩', text: nice(p) }))} sel=${sel} columns=${mainWidth} small /><//>`;
  } else {
    const shown = prompt?.kind === 'done' ? prompt.pictures : drawn;
    middle = html`<${Box} flexDirection="column" alignItems="center">
      ${lastKid && html`<${Text} color="cyan">🧒 ${lastKid.text}<//>`}
      ${lastKidex && html`<${Bubble} error=${lastKidex.who === 'error'} width=${Math.min(72, mainWidth - 8)}>${lastKidex.text}<//>`}
      <${Pictures} files=${shown} />
      ${busy && html`<${Working} tick=${tick} activity=${activity} label=${w('working')} />`}
      ${!busy && ear === 'idle' && typing === null && choices.length > 0 && html`<${Tiles} items=${choices.map(splitEmoji)} sel=${sel} columns=${mainWidth} />`}
      ${ear === 'recording' && html`
        <${Box} borderStyle="bold" borderColor="red" paddingX=${4} paddingY=${1} marginTop=${1} flexDirection="column" alignItems="center">
          <${Text} color="red" bold>${tick % 2 ? '🔴' : '⭕'}  ${w('listening')}<//>
          <${Text} color="gray">${w('stopTalk')}<//>
        <//>`}
      ${ear === 'hearing' && html`<${Box} marginTop=${1}><${Text} color="yellow" bold>👂 ${w('hearing')}<//><//>`}
      ${typing !== null && html`
        <${Box} borderStyle="round" borderColor="cyan" paddingX=${2} marginTop=${1} width=${Math.min(72, mainWidth - 8)}>
          <${Text}>${typing}${tick % 2 ? '▌' : ' '}<//>
        <//>`}<//>`;
  }

  const hints = typing !== null
    ? [['⏎', w('send')], ['ESC', w('back')]]
    : screen === 'chat'
    ? [!busy && ear === 'idle' && choices.length > 0 && ['⏎', w('choose')], !busy && ear !== 'hearing' && ['␣', ear === 'recording' ? w('done') : w('talk')], !busy && ear === 'idle' && ['T', w('type')], ['ESC', w('back')]]
    : toPanel
    ? [['ESC', `🧱 ${w('buttons')}`]]
    : [['⏎', w('choose')], split && ['TAB', panel.title], ['L', `${flag.flag} ${flag.name}`], screen === 'home' ? ['Q', w('quit')] : ['ESC', w('back')]];

  return html`
    <${Box} width=${columns} height=${rows} flexDirection="column">
      <${Box} justifyContent="space-between" paddingX=${1}>
        <${Text} color="gray">🧱 Kidex · ${config.name}<//>
        <${Text} color="gray">${cost > 0 ? `$${cost.toFixed(2)}` : ''}<//>
      <//>
      <${Box} flexGrow=${1}>
        <${Box} flexGrow=${split ? 0 : 1} width=${split ? COLUMN : undefined} flexDirection="column" alignItems="center" justifyContent="center">
          ${middle}
        <//>
        ${split && html`<${TerminalView} panel=${panel} focused=${toPanel} width=${columns - COLUMN} height=${rows - 2} note=${panel.code !== null && w('stopped')} />`}
        ${showPanel && html`<${FilesPanel} files=${files} now=${busy ? now : null} lang=${lang} explain=${config.explain} words=${w} />`}
      <//>
      <${Box} justifyContent="center" gap=${3}>
        ${hints.filter(Boolean).map(([k, v]) => html`<${Text} key=${k} color="gray"><${Text} inverse bold> ${k} <//> ${v}<//>`)}
      <//>
    <//>`;
}

const COLORS = ['green', 'blue', 'magenta', 'yellow', 'cyan', 'red'];

/** "my-mod" → "My mod" */
const nice = s => s.replace(/[-_]/g, ' ').replace(/^./, c => c.toUpperCase());

/** "🎵 Happy pop" → {emoji: "🎵", text: "Happy pop"} */
function splitEmoji(s) {
  const m = /^(\p{Extended_Pictographic}[\p{Extended_Pictographic}\u{FE0F}\u{200D}]*)\s*(.*)$/u.exec(s);
  return m ? { emoji: m[1], text: m[2] } : { emoji: '', text: s };
}

const Title = ({ children }) => html`<${Box} marginBottom=${1}><${Text} bold color="cyanBright">${children}<//><//>`;

/** Big centered tiles, a few per row. The selected one is filled with its colour. */
function perRowFor(n, columns, small) {
  let perRow = small ? Math.min(n, 4) : n === 4 ? 2 : Math.min(n, 3);
  while (perRow > 1 && perRow * 24 > columns - 4) perRow--;
  return perRow;
}

function Tiles({ items, sel, columns, small }) {
  const n = items.length;
  const perRow = perRowFor(n, columns, small);
  const width = Math.min(small ? 24 : 34, Math.floor((columns - 4) / perRow) - 2);
  const rowsOf = [];
  for (let i = 0; i < n; i += perRow) rowsOf.push(items.slice(i, i + perRow).map((item, j) => ({ ...item, i: i + j })));
  return html`
    <${Box} flexDirection="column" alignItems="center">
      ${rowsOf.map((row, r) => html`
        <${Box} key=${r} gap=${2}>
          ${row.map(({ emoji, text, i }) => {
            const on = i === sel;
            const color = COLORS[i % COLORS.length];
            return html`
              <${Box} key=${i} width=${width} height=${small ? 5 : 7} borderStyle=${on ? 'bold' : 'round'} borderColor=${on ? 'whiteBright' : color}
                backgroundColor=${on ? color : undefined} flexDirection="column" alignItems="center" justifyContent="center" paddingX=${1}>
                ${emoji && html`<${Text}>${emoji}<//>`}
                <${Text} bold color=${on ? 'black' : color} wrap="wrap">${text}<//>
              <//>`;
          })}
        <//>`)}
    <//>`;
}

const COLUMN = 28;

/** The buttons as one short column, beside a panel program. sel -1: none chosen, the keys go to the program. */
function Column({ items, sel }) {
  return html`
    <${Box} flexDirection="column" alignItems="center">
      ${items.map(({ emoji, text }, i) => {
        const on = i === sel;
        const color = COLORS[i % COLORS.length];
        return html`
          <${Box} key=${i} width=${COLUMN - 2} borderStyle=${on ? 'bold' : 'round'} borderColor=${on ? 'whiteBright' : sel < 0 ? 'gray' : color}
            backgroundColor=${on ? color : undefined} paddingX=${1}>
            <${Text} bold color=${on ? 'black' : sel < 0 ? 'gray' : color} wrap="truncate-end">${emoji} ${text}<//>
          <//>`;
      })}
    <//>`;
}

function Bubble({ children, error, width }) {
  return html`
    <${Box} borderStyle="round" borderColor=${error ? 'red' : 'whiteBright'} paddingX=${2} paddingY=${1} marginY=${1} width=${width} justifyContent="center">
      <${Text} bold color=${error ? 'red' : 'whiteBright'}>${error ? '😕 ' : '🤖 '}${children}<//>
    <//>`;
}

function Working({ tick, activity, label }) {
  const pick = ['⛏️ ', ' ⛏️'][tick % 2];
  const blocks = '🟫'.repeat(tick % 6) + '⬛'.repeat(5 - (tick % 6));
  return html`
    <${Box} flexDirection="column" alignItems="center" marginTop=${1}>
      <${Text} color="yellow" bold>${pick} ${blocks}<//>
      <${Text} color="yellow">${label}…<//>
      ${activity && html`<${Text} color="gray">${activity.emoji} ${activity.text}<//>`}
    <//>`;
}

function Pictures({ files = [] }) {
  // Decoding PNGs is slow; only redo it when the list of files changes.
  const drawn = useMemo(() => files.map(f => {
    try { return { f, lines: renderPicture(f, { width: 24 }) }; } catch { return null; }
  }).filter(Boolean), [files.join('\n')]);
  if (!drawn.length) return null;
  return html`
    <${Box} gap=${2} marginBottom=${1}>
      ${drawn.map(({ f, lines }) => html`<${Box} key=${f} flexDirection="column">${lines.map((l, i) => html`<${Text} key=${i}>${l}<//>`)}<//>`)}
    <//>`;
}

const PANEL = 42;

/**
 * The files panel: a little tree of what Claude made (✨) or changed (🔨),
 * and, for the file it is working on now, what kind of file it is and a peek inside.
 */
function FilesPanel({ files, now, lang, explain, words }) {
  const list = Object.entries(files).sort((a, b) => a[0].localeCompare(b[0])).slice(-14);
  const byDir = {};
  for (const [file, info] of list) {
    const dir = path.dirname(file);
    (byDir[dir] ??= []).push({ file, ...info });
  }
  const short = d => d === '.' ? '' : d.split('/').slice(-2).join('/') + '/';
  const about = now && describe(now.file, lang, explain);
  const code = now && now.action !== 'read' && now.action !== 'draw' ? peek(now.content, { width: PANEL - 6 }) : [];
  return html`
    <${Box} width=${PANEL} flexDirection="column" borderStyle="round" borderColor="gray" paddingX=${1} marginRight=${1}>
      <${Text} bold color="gray">📁 ${words('yourFiles')}<//>
      ${Object.entries(byDir).map(([dir, items]) => html`
        <${Box} key=${dir} flexDirection="column" marginTop=${1}>
          ${short(dir) && html`<${Text} color="blue" wrap="truncate-start">${short(dir)}<//>`}
          ${items.map(f => {
            const here = now?.file === f.file;
            return html`<${Text} key=${f.file} wrap="truncate-end" bold=${here} color=${here ? 'whiteBright' : undefined}>
              ${' '}${describe(f.file, lang, explain).icon} ${path.basename(f.file)} <${Text} color=${f.isNew ? 'green' : 'yellow'}>${f.isNew ? '✨' : '🔨'}<//>${here ? ' ◀' : ''}
            <//>`;
          })}
        <//>`)}
      ${now && html`
        <${Box} flexDirection="column" marginTop=${1} borderStyle="single" borderTop borderBottom=${false} borderLeft=${false} borderRight=${false} borderColor="gray">
          <${Text} color="yellow" wrap="truncate-end">${about.icon} ${words(now.action)} ${path.basename(now.file)}<//>
          <${Text} color="gray" wrap="wrap">${about.text}<//>
          ${code.length > 0 && html`
            <${Box} flexDirection="column" marginTop=${1}>
              ${code.map((l, i) => html`<${Text} key=${i} color="cyan" dimColor wrap="truncate-end">${l}<//>`)}
            <//>`}
        <//>`}
    <//>`;
}
