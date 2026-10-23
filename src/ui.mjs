// The screen kids see: big buttons, push-to-talk, and pictures.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import htm from 'htm';
import { createSession } from './session.mjs';
import { spawn } from 'node:child_process';
import { text as label, pickChoices, fill, loadSettings, saveSettings } from './config.mjs';
import { abilities, startRecording, transcribe, speak, hush, guessLang } from './voice.mjs';
import { render as renderPicture } from './pictures.mjs';

const html = htm.bind(React.createElement);

const WORDS = {
  hello: { en: 'Hi! What do you want to do?', da: 'Hej! Hvad vil du lave?' },
  pick: { en: 'Which one?', da: 'Hvilken en?' },
  tell: { en: 'Tell me about it! Press space and talk.', da: 'Fortæl mig om det! Tryk på mellemrum og snak.' },
  right: { en: 'Is that right?', da: 'Er det rigtigt?' },
  yes: { en: 'Yes!', da: 'Ja!' },
  no: { en: 'No', da: 'Nej' },
  talk: { en: 'talk', da: 'snak' },
  stopTalk: { en: 'I am listening… press SPACE when you are done', da: 'Jeg lytter… tryk MELLEMRUM når du er færdig' },
  hearing: { en: 'Let me hear…', da: 'Lad mig høre…' },
  type: { en: 'type', da: 'skriv' },
  back: { en: 'back', da: 'tilbage' },
  quit: { en: 'quit', da: 'slut' },
  working: { en: 'Working on it', da: 'Jeg arbejder på det' },
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
  const [ear, setEar] = useState('idle'); // idle | recording | hearing
  const [typing, setTyping] = useState(null);
  const [cost, setCost] = useState(0);
  const [tick, setTick] = useState(0);

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

  const say = (who, text) => setLines(l => [...l.slice(-30), { who, text }]);
  const voice = text => { if (!quiet) speak(text, { lang: langRef.current, voices: config.voices }); };

  useEffect(() => {
    if (screen === 'home') voice(w('hello'));
    return () => hush();
  }, [screen]);

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
      case 'picture':
        setDrawn(d => [...d.filter(f => f !== e.file), e.file].slice(-3)); break;
      case 'blocked':
        say('lock', e.why); break;
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
    setAction(a); setPick(p); setLines([]); setDrawn([]); setScreen('chat');
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
    setScreen('home'); setSel(0); setPrompt(null); setBusy(false); setActivity(null);
  }

  const choices = screen === 'home' ? config.actions.map(a => `${a.emoji} ${label(a.label, lang)}`)
    : screen === 'pick' ? picks
    : prompt?.choices ?? [];

  useInput((input, key) => {
    if (typing !== null) {
      if (key.return) { const t = typing; setTyping(null); submit(t); }
      else if (key.escape) setTyping(null);
      else if (key.backspace || key.delete) setTyping(t => t.slice(0, -1));
      else if (input && !key.ctrl && !key.meta) setTyping(t => t + input);
      return;
    }
    if (key.escape) { if (screen !== 'home') home(); return; }
    if ((input === 'l' || input === 'L') && ear === 'idle') { nextLanguage(); return; }
    if (screen === 'home' && input === 'q') { exit(); return; }

    const n = choices.length;
    if (n && (key.downArrow || key.rightArrow)) { setSel(s => (s + 1) % n); return; }
    if (n && (key.upArrow || key.leftArrow)) { setSel(s => (s - 1 + n) % n); return; }
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

  return html`
    <${Box} flexDirection="column" paddingX=${1}>
      <${Header} name=${config.name} cost=${cost} language=${LANGUAGES.find(l => l.id === language) ?? LANGUAGES[2]} />
      ${screen === 'home' && html`
        <${Big}>${w('hello')}<//>
        <${Buttons} items=${choices} sel=${sel} column />
        <${Keys} items=${[['↑↓', ''], ['ENTER', '✔'], ['Q', w('quit')]]} />
      `}
      ${screen === 'pick' && html`
        <${Big}>${w('pick')}<//>
        <${Buttons} items=${choices} sel=${sel} column />
        <${Keys} items=${[['↑↓', ''], ['ENTER', '✔'], ['ESC', w('back')]]} />
      `}
      ${screen === 'chat' && html`
        <${Chat} lines=${lines} />
        ${prompt?.kind === 'done' ? html`<${Pictures} files=${prompt.pictures} />` : html`<${Pictures} files=${drawn} />`}
        ${busy && html`<${Working} tick=${tick} activity=${activity} label=${w('working')} />`}
        ${!busy && choices.length > 0 && html`<${Buttons} items=${choices} sel=${sel} />`}
        ${ear === 'recording' && html`<${Box} borderStyle="bold" borderColor="red" paddingX=${2}><${Text} color="red" bold>${tick % 2 ? '🔴' : '⭕'} ${w('stopTalk')}<//><//>`}
        ${ear === 'hearing' && html`<${Text} color="yellow">👂 ${w('hearing')}<//>`}
        ${typing !== null && html`<${Box} borderStyle="round" borderColor="cyan" paddingX=${1}><${Text}>⌨️  ${typing}${tick % 2 ? '▌' : ' '}<//><//>`}
        ${prompt?.kind === 'done' && !busy && html`<${Text} color="gray">${w('more')}<//>`}
        <${Keys} items=${[
          !busy && ear !== 'hearing' && ['SPACE', `🎤 ${w('talk')}`],
          !busy && ['T', `⌨️  ${w('type')}`],
          ['ESC', `🏠 ${w('back')}`],
        ].filter(Boolean)} />
      `}
    <//>`;
}

function Header({ name, cost, language }) {
  return html`
    <${Box} justifyContent="space-between" marginBottom=${1}>
      <${Text} bold color="greenBright">🧱 Kidex <${Text} color="gray">· ${name}<//><//>
      <${Text} color="gray">${cost > 0 ? `$${cost.toFixed(2)}   ` : ''}<${Text} inverse bold> L <//> ${language.flag} ${language.name}<//>
    <//>`;
}

const Big = ({ children }) => html`<${Box} marginBottom=${1}><${Text} bold color="cyanBright">${children}<//><//>`;

const COLORS = ['green', 'blue', 'magenta', 'yellow'];

function Buttons({ items, sel, column }) {
  return html`
    <${Box} flexDirection=${column ? 'column' : 'row'} flexWrap="wrap" gap=${column ? 0 : 1}>
      ${items.map((item, i) => html`
        <${Box} key=${i} borderStyle=${i === sel ? 'double' : 'round'} borderColor=${i === sel ? 'whiteBright' : COLORS[i % COLORS.length]} paddingX=${2}>
          <${Text} bold=${i === sel} color=${i === sel ? 'whiteBright' : COLORS[i % COLORS.length]}>${i + 1}  ${item}<//>
        <//>`)}
    <//>`;
}

function Chat({ lines }) {
  return html`
    <${Box} flexDirection="column" marginBottom=${1}>
      ${lines.slice(-8).map((l, i) => {
        if (l.who === 'kid') return html`<${Text} key=${i} color="cyan">🧒 ${l.text}<//>`;
        if (l.who === 'lock') return html`<${Text} key=${i} color="gray" dimColor>🔒 ${l.text}<//>`;
        if (l.who === 'error') return html`<${Text} key=${i} color="red">😕 ${l.text}<//>`;
        return html`<${Text} key=${i} color="whiteBright" bold>🤖 ${l.text}<//>`;
      })}
    <//>`;
}

function Working({ tick, activity, label }) {
  const pick = ['⛏️ ', ' ⛏️'][tick % 2];
  const blocks = '🟫'.repeat(tick % 6) + '⬛'.repeat(5 - (tick % 6));
  return html`
    <${Box} flexDirection="column" marginBottom=${1}>
      <${Text} color="yellow">${pick} ${blocks}  ${label}…<//>
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

function Keys({ items }) {
  return html`
    <${Box} gap=${2} marginTop=${1}>
      ${items.map(([k, v]) => html`<${Text} key=${k}><${Text} inverse bold> ${k} <//> ${v}<//>`)}
    <//>`;
}
