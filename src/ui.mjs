// The screen kids see: big buttons, push-to-talk, and pictures.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Text, useApp, useInput, useWindowSize } from 'ink';
import htm from 'htm';
import { createSession } from './session.mjs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { text as label, pickChoices, fill, loadSettings, saveSettings, sessionConfig } from './config.mjs';
import { abilities, startRecording, transcribe, speak, hush, guessLang, warmUp, chime } from './voice.mjs';
import { render as renderPicture } from './pictures.mjs';
import { describe, peek } from './files.mjs';
import { openPanel, resizePanel, pressKey, escapePanel, usePanel, TerminalView } from './panel.mjs';
import { usePresses, PressArea, Press } from './mouse.mjs';

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
  oops: { en: 'Oops, something got stuck. Try saying it again, or ask a grown-up.', da: 'Ups, noget drillede. Prøv at sige det igen, eller spørg en voksen.' },
  madeIt: { en: 'You made it!', da: 'Du lavede det!' },
  how: { en: 'How does it work?', da: 'Hvordan virker det?' },
  change: { en: 'Change something', da: 'Lav noget om' },
  finished: { en: 'Done for now', da: 'Færdig for nu' },
  whatChange: { en: 'What do you want to change? Press space and tell me.', da: 'Hvad vil du lave om? Tryk mellemrum og fortæl mig det.' },
  explainIt: {
    en: 'How does what you made work? Show me the most important parts, simply.',
    da: 'Hvordan virker det, du lavede? Vis mig de vigtigste dele, helt enkelt.',
  },
  whileYouWait: { en: 'While you wait…', da: 'Mens du venter…' },
  correct: { en: 'Right!', da: 'Rigtigt!' },
  notQuite: { en: 'Not quite!', da: 'Ikke helt!' },
  plan: { en: 'The plan', da: 'Planen' },
  // The line at the bottom that says what to do now.
  guideHome: { en: '👉 Pick with the arrow keys and press ENTER, or press SPACE and say what you want', da: '👉 Vælg med piletasterne og tryk ENTER, eller tryk MELLEMRUM og sig hvad du vil' },
  sayIt: { en: 'say it', da: 'sig det' },
  guideTurn: { en: '👉 Your turn! Press SPACE and talk', da: '👉 Din tur! Tryk MELLEMRUM og snak' },
  guideChoose: { en: '👉 Your turn! Pick an answer and press ENTER, or press SPACE and talk', da: '👉 Din tur! Vælg et svar og tryk ENTER, eller tryk MELLEMRUM og snak' },
  guidePlan: { en: '👉 Your turn! Is the plan good? 👍 or 👎', da: '👉 Din tur! Er planen god? 👍 eller 👎' },
  guideTalking: { en: '🔴 Talk now! Press SPACE when you are done', da: '🔴 Snak nu! Tryk MELLEMRUM når du er færdig' },
  guideHearing: { en: '👂 Wait a moment, I am writing down what you said…', da: '👂 Vent lidt, jeg skriver det ned, du sagde…' },
  guideWorking: { en: '⏳ Kidex is building. Want to add something? Press SPACE and talk', da: '⏳ Kidex bygger. Vil du tilføje noget? Tryk MELLEMRUM og snak' },
  guideQuiz: { en: '🤔 While you wait: pick an answer with the arrows and ENTER', da: '🤔 Mens du venter: vælg et svar med pilene og ENTER' },
  guideTyping: { en: '⌨️ Type, then press ENTER', da: '⌨️ Skriv, og tryk ENTER' },
  openIt: { en: 'open', da: 'åbn' },
  backToKidex: { en: 'back to Kidex', da: 'tilbage til Kidex' },
  guideDone: { en: '🎉 What now? Pick one and press ENTER', da: '🎉 Hvad nu? Vælg en og tryk ENTER' },
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

  // The button selected on the start screen: kidex.json's "start" names one by id, otherwise the first.
  const first = Math.max(0, config.actions.findIndex(a => a.id === config.start));
  const [screen, setScreen] = useState('home');
  const [sel, setSel] = useState(first);
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
  const [big, setBig] = useState(false); // away from the start screen, the panel is a strip on the right; TAB makes it big
  const [steps, setSteps] = useState([]); // the plan's big steps, ticked off while Claude builds
  const [stepAt, setStepAt] = useState(-1); // the step being worked on; steps.length when all are done
  const [quiz, setQuiz] = useState(null); // {question, choices, answer, explain, sel, picked}: something to think about while waiting
  const [level, setLevel] = useState(0); // how loud the kid is while recording, 0..1
  const [party, setParty] = useState(null); // {big, name, until}: confetti
  const [leaving, setLeaving] = useState(null); // after something quick, Kidex goes back to the start at this time

  const session = useRef(null);
  const recording = useRef(null);
  const langRef = useRef(lang);
  langRef.current = lang;

  // The kid's turn: the mic pulses, so they know Kidex waits for them.
  const myTurn = screen === 'chat' && !busy && ear === 'idle' && typing === null && prompt !== null;

  // The animation clock only runs while something moves, so menus don't redraw for nothing.
  const animating = busy || ear !== 'idle' || typing !== null || myTurn || party !== null;
  const speed = party ? 90 : 300;
  useEffect(() => {
    if (!animating) return;
    const t = setInterval(() => setTick(n => n + 1), speed);
    return () => clearInterval(t);
  }, [animating, speed]);
  useEffect(() => {
    if (!party) return;
    const t = setTimeout(() => setParty(null), party.until - Date.now());
    return () => clearTimeout(t);
  }, [party]);

  function celebrate(big, name) {
    setParty({ big, name, until: Date.now() + (big ? 4000 : 1500) });
    if (!quiet) chime(big ? 'Hero' : 'Glass');
  }

  // Load the voice for the current language now, so the first sentence isn't slow.
  useEffect(() => { if (!quiet) warmUp(lang, config.voices); }, [lang]);

  const say = (who, text, more) => setLines(l => [...l.slice(-30), { who, text, ...more }]);
  const voice = text => { if (!quiet) speak(text, { lang: langRef.current, voices: config.voices }); };

  function onEvent(e) {
    switch (e.type) {
      case 'speak':
        say('kidex', e.text, { kind: e.kind }); voice(e.text);
        if (e.step) setStepAt(e.step - 1);
        if (e.kind === 'fixed') celebrate(false);
        break;
      case 'ask':
        say('kidex', e.question); voice(e.question);
        setPrompt({ kind: 'ask', choices: e.choices }); setSel(0); setBusy(false); break;
      case 'plan':
        say('kidex', e.summary); voice(`${e.summary} ${w('right')}`);
        setSteps(e.steps); setStepAt(-1);
        setPrompt({ kind: 'plan', choices: [`👍 ${w('yes')}`, `👎 ${w('no')}`] }); setSel(0); setBusy(false); break;
      case 'approved':
        setStepAt(0); celebrate(false); break;
      case 'quiz':
        setQuiz({ ...e, sel: 0, picked: null }); voice(e.question); break;
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
        if (e.quick) {
          // Something quick, like a kit: no party, and back to the start once it's been said, unless the kid goes on.
          celebrate(false); setQuiz(null); setPrompt({ kind: 'free' }); setBusy(false);
          setLeaving(Date.now() + 3000 + 70 * e.summary.length);
          break;
        }
        setStepAt(Infinity); setQuiz(null); celebrate(true, e.name);
        setPrompt({ kind: 'done', pictures: e.pictures, choices: [`🔍 ${w('how')}`, `🔧 ${w('change')}`, `🏠 ${w('finished')}`] }); setSel(0);
        setBusy(false); break;
      case 'error':
        // Grown-up words (the real error) stay small; the kid hears that it's OK to try again.
        say('error', w('oops'), { detail: e.message }); voice(w('oops'));
        setBusy(false); setPrompt(p => p ?? { kind: 'free' }); break;
      case 'turn':
        setCost(e.cost ?? 0); setBusy(false); setPrompt(p => p ?? { kind: 'free' }); break;
    }
  }

  function begin(a, p) {
    if (a.run) {
      // A plain command, no Claude: like opening a toy to play with it.
      spawn(fill(a.run, { pick: p }), { cwd, shell: true, stdio: 'ignore', detached: true }).unref();
      voice(w('fun'));
      setScreen('home'); setSel(first);
      return;
    }
    if (a.panel) {
      // A program that keeps running, like a dev screen: it fills the screen, the buttons move to the left.
      openPanel(fill(a.panel, { pick: p }), { cwd, title: `${a.emoji} ${label(a.label, lang)}`, cols: panelWidth - 2, rows: panelHeight - 2 });
      setScreen('home'); setSel(config.actions.indexOf(a)); setOnPanel(true);
      return;
    }
    setAction(a); setPick(p); setLines([]); setDrawn([]); setFiles({}); setNow(null); setSteps([]); setStepAt(-1); setQuiz(null); setScreen('chat');
    setPrompt({ kind: 'first' });
    session.current = createSession({ cwd, config: sessionConfig(config, a, { language }), onEvent });
    if (a !== config.talk) { say('kidex', w('tell')); voice(w('tell')); }
  }

  /** SPACE on the start screen: no button, the kid just says what they want, and Claude works out what to do. */
  function talk() {
    begin(config.talk, null);
    toggleMic();
  }

  // After something quick, back to the start, unless the kid talks or types again first.
  useEffect(() => {
    if (leaving === null) return;
    if (ear !== 'idle' || typing !== null) { setLeaving(null); return; }
    const t = setTimeout(home, Math.max(0, leaving - Date.now()));
    return () => clearTimeout(t);
  }, [leaving, ear, typing]);

  /** words: what the kid said or picked; send: what Claude gets, when that should say more. */
  function submit(words, send = words) {
    words = words.trim();
    if (!words) return;
    hush();
    const l = language === 'auto' ? guessLang(words, langRef.current) : language;
    setLang(l); langRef.current = l;
    say('kid', words);
    setLeaving(null);
    const was = prompt;
    setPrompt(null); setBusy(true); setActivity(null);
    if (was?.kind === 'first') session.current.start({ action, pick, words, lang: l });
    else if (was?.kind === 'plan' && (words === was.choices[0] || words === was.choices[1])) session.current.answer(words.slice(0, 2));
    else session.current.answer(send);
  }

  function pickDone(i) {
    if (i === 0) submit(prompt.choices[0], label(WORDS.explainIt, langRef.current));
    else if (i === 1) { setPrompt({ kind: 'free' }); say('kidex', w('whatChange')); voice(w('whatChange')); }
    else home();
  }

  function answerQuiz(i) {
    if (!quiz || quiz.picked !== null || !quiz.choices[i]) return;
    setQuiz(q => ({ ...q, picked: i }));
    const right = i === quiz.answer;
    voice(`${w(right ? 'correct' : 'notQuite')} ${quiz.explain}`);
    if (right) celebrate(false);
  }

  async function toggleMic() {
    if (!canTalk) { say('error', w('noMic')); return; }
    if (ear === 'idle') {
      hush();
      try { setLevel(0); recording.current = startRecording({ onLevel: setLevel }); setEar('recording'); } catch (e) { say('error', e.message); }
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
    setScreen('home'); setSel(first); setPrompt(null); setBusy(false); setActivity(null); setOnPanel(false); setBig(false); setLeaving(null);
  }

  const choices = screen === 'home' ? config.actions.map(a => `${a.emoji} ${label(a.label, lang)}`)
    : screen === 'pick' ? picks
    : prompt?.choices ?? [];

  // With a panel program running, the start screen is that program, with the buttons in a column on the left.
  // Elsewhere it keeps running on the right, narrower, and TAB makes it big again (with Kidex as a card on the left).
  const panel = usePanel();
  // Narrow, tall screens put the parts above each other instead of side by side.
  const stacked = columns < NARROW && rows >= 30;
  const split = screen === 'home' && panel !== null;
  const strip = screen !== 'home' && panel !== null && (stacked || columns >= 80);
  const expanded = strip && big;
  const toPanel = (split && onPanel || expanded) && panel.code === null;
  const beside = strip && !expanded;
  const buttons = config.actions.map(a => ({ emoji: a.emoji, text: label(a.label, lang) }));
  const row = rowOf(buttons, columns);
  // Where the program is shown: right of the buttons or the Kidex card, or under them when stacked.
  const panelWidth = stacked ? columns : columns - COLUMN;
  const panelHeight = rows - 3 - (!stacked ? 0 : screen === 'home' ? row.height : CARD);
  // While building it runs in a strip: on the right, or along the bottom when stacked.
  const stripWidth = stacked ? columns : Math.min(90, Math.max(STRIP, Math.floor(columns * 0.4)));
  const stripHeight = stacked ? Math.max(8, Math.floor((rows - 3) * 0.4)) : rows - 3;
  // The program's terminal takes the size of where it is shown, so it lays itself out for it.
  useEffect(() => {
    if (beside) resizePanel(stripWidth - 2, stripHeight - STRIP_CHROME);
    else resizePanel(panelWidth - 2, panelHeight - 2);
  }, [beside, stripWidth, stripHeight, panelWidth, panelHeight]);

  // While building, wide screens show what happens to the files on the left; tall ones under Kidex.
  const room = columns - (strip && !stacked ? stripWidth : 0);
  const showPanel = screen === 'chat' && (stacked ? rows >= 45 : room >= 100) && Object.keys(files).length + (now ? 1 : 0) > 0;
  const mainWidth = room - (showPanel && !stacked ? PANEL : 0);

  /** ENTER, a number, or a press on button i. */
  function choose(i) {
    if (screen === 'home') {
      const a = config.actions[i];
      if (a.pick) {
        const list = pickChoices(cwd, a.pick);
        setAction(a); setPicks(list); setSel(0); setScreen('pick'); voice(w('pick'));
      } else begin(a, null);
    } else if (screen === 'pick') {
      if (picks[i]) begin(action, picks[i]);
    } else if (!busy && ear === 'idle') {
      if (prompt?.kind === 'done') pickDone(i);
      else if (choices[i]) submit(choices[i]);
    }
  }

  const leavePanel = () => { setOnPanel(false); setBig(false); };
  const presses = usePresses(typing === null);

  useInput((input, key) => {
    if (typing !== null) {
      if (key.return) { const t = typing; setTyping(null); submit(t); }
      else if (key.escape) setTyping(null);
      else if (key.backspace || key.delete) setTyping(t => t.slice(0, -1));
      else if (input && !key.ctrl && !key.meta) setTyping(t => t + input);
      return;
    }
    if (toPanel) {
      // SHIFT+TAB leaves at once; ESC may close the program's own menu first.
      if (key.tab && key.shift) leavePanel();
      else if (key.escape) escapePanel(leavePanel);
      else pressKey(input, key);
      return;
    }
    if (expanded) { if (key.escape || key.tab) setBig(false); return; } // the program has stopped
    if (split && key.tab && !key.shift) { setOnPanel(true); return; }
    if (strip && key.tab && !key.shift) { setBig(true); return; }
    if (key.escape) { if (screen !== 'home') home(); return; }
    if ((input === 'l' || input === 'L') && ear === 'idle') { nextLanguage(); return; }
    if (screen === 'home' && input === 'q') { exit(); return; }
    if (screen === 'home' && input === ' ') { talk(); return; }

    const n = choices.length;
    // Tiles sit in a grid: left/right move one, up/down a whole row.
    const step = split ? (stacked ? row.across : 1) : perRowFor(n, mainWidth, screen === 'pick');
    if (n && key.rightArrow) { setSel(s => (s + 1) % n); return; }
    if (n && key.leftArrow) { setSel(s => (s - 1 + n) % n); return; }
    if (n && key.downArrow) { setSel(s => (s + step < n ? s + step : s % step)); return; }
    if (n && key.upArrow) { setSel(s => (s - step >= 0 ? s - step : Math.min(n - 1, s + step * Math.floor((n - 1 - s) / step)))); return; }
    const digit = Number(input);
    const chosen = key.return ? sel : digit >= 1 && digit <= n ? digit - 1 : null;

    if (screen !== 'chat' && chosen != null) { choose(chosen); return; }

    if (screen === 'chat' && busy && quiz && quiz.picked === null && ear === 'idle') {
      const m = quiz.choices.length;
      if (key.rightArrow || key.downArrow) { setQuiz(q => ({ ...q, sel: (q.sel + 1) % m })); return; }
      if (key.leftArrow || key.upArrow) { setQuiz(q => ({ ...q, sel: (q.sel - 1 + m) % m })); return; }
      const d = Number(input);
      if (key.return) { answerQuiz(quiz.sel); return; }
      if (d >= 1 && d <= m) { answerQuiz(d - 1); return; }
    }

    if (screen === 'chat') {
      if (chosen != null && !busy && ear === 'idle') { choose(chosen); return; }
      // Also while Kidex builds: what the kid adds goes to Claude as it works.
      if (input === ' ') { toggleMic(); return; }
      if ((input === 't' || input === 'T') && ear === 'idle') { setTyping(''); return; }
      if (prompt?.kind === 'plan' && (input === 'y' || input === 'j')) { submit(choices[0]); return; }
      if (prompt?.kind === 'plan' && input === 'n') { submit(choices[1]); return; }
    }
  });


  const lastKidex = [...lines].reverse().find(l => l.who === 'kidex' || l.who === 'error');
  const lastKid = [...lines].reverse().find(l => l.who === 'kid');
  const flag = LANGUAGES.find(l => l.id === language) ?? LANGUAGES[2];

  let middle;
  if (split) {
    middle = html`<${Column} items=${buttons} sel=${toPanel ? -1 : sel} row=${stacked ? row : null}
      onPress=${i => { if (toPanel) { leavePanel(); setSel(i); } else choose(i); }} />`;
  } else if (screen === 'home') {
    middle = html`<${Box} flexDirection="column" alignItems="center">
      <${Title}>${w('hello')}<//>
      <${Tiles} items=${buttons} sel=${sel} columns=${mainWidth} onPress=${choose} /><//>`;
  } else if (screen === 'pick') {
    middle = html`<${Box} flexDirection="column" alignItems="center">
      <${Title}>${w('pick')}<//>
      <${Tiles} items=${picks.map(p => ({ emoji: '🧩', text: nice(p) }))} sel=${sel} columns=${mainWidth} small onPress=${choose} /><//>`;
  } else {
    const shown = prompt?.kind === 'done' ? prompt.pictures : drawn;
    const checklist = steps.length > 0 && stepAt >= 0;
    middle = html`<${Box} flexDirection="column" alignItems="center">
      ${lastKid && html`<${Text} color="cyan">🧒 ${lastKid.text}<//>`}
      ${lastKidex && html`<${Bubble} kind=${lastKidex.who === 'error' ? 'error' : lastKidex.kind} detail=${lastKidex.detail} tight=${busy} width=${Math.min(72, mainWidth - 8)}>${lastKidex.text}<//>`}
      ${prompt?.kind === 'plan' && steps.length > 0 && html`<${Checklist} steps=${steps} at=${-1} title=${w('plan')} />`}
      <${Pictures} files=${shown} />
      ${busy && html`<${Working} tick=${tick} activity=${activity} label=${w('working')} />`}
      ${checklist && (busy || prompt?.kind === 'done') && html`<${Checklist} steps=${steps} at=${stepAt} tick=${tick} short=${busy && quiz !== null} />`}
      ${busy && quiz && html`<${Quiz} quiz=${quiz} title=${w('whileYouWait')} words=${w} width=${Math.min(72, mainWidth - 8)} onPress=${ear === 'idle' ? answerQuiz : null} />`}
      ${myTurn && html`<${Mic} tick=${tick} onPress=${toggleMic} />`}
      ${!busy && ear === 'idle' && typing === null && choices.length > 0 && html`<${Tiles} items=${choices.map(splitEmoji)} sel=${sel} columns=${mainWidth} onPress=${choose} />`}
      ${ear === 'recording' && html`
        <${Press} on=${toggleMic} borderStyle="bold" borderColor="red" paddingX=${4} paddingY=${1} marginTop=${1} flexDirection="column" alignItems="center">
          <${Text} color="red" bold>${tick % 2 ? '🔴' : '⭕'}  ${w('listening')}<//>
          <${Meter} level=${level} />
          <${Text} color="gray">${w('stopTalk')}<//>
        <//>`}
      ${ear === 'hearing' && html`<${Box} marginTop=${1}><${Text} color="yellow" bold>👂 ${w('hearing')}<//><//>`}
      ${typing !== null && html`
        <${Box} borderStyle="round" borderColor="cyan" paddingX=${2} marginTop=${1} width=${Math.min(72, mainWidth - 8)}>
          <${Text}>${typing}${tick % 2 ? '▌' : ' '}<//>
        <//>`}<//>`;
  }

  const guide = typing !== null ? w('guideTyping')
    : screen !== 'chat' ? w('guideHome')
    : ear === 'recording' ? w('guideTalking')
    : ear === 'hearing' ? w('guideHearing')
    : busy ? (quiz && quiz.picked === null ? w('guideQuiz') : w('guideWorking'))
    : prompt?.kind === 'plan' ? w('guidePlan')
    : prompt?.kind === 'done' ? w('guideDone')
    : prompt && choices.length > 0 ? w('guideChoose')
    : prompt ? w('guideTurn')
    : null;
  const guideColor = ear === 'recording' ? 'red' : busy || ear === 'hearing' ? 'yellow' : 'greenBright';

  const hints = typing !== null
    ? [['⏎', w('send')], ['ESC', w('back')]]
    : expanded
    ? [['ESC', `🧱 ${w('backToKidex')}`]]
    : screen === 'chat'
    ? [!busy && ear === 'idle' && choices.length > 0 && ['⏎', w('choose')], ear !== 'hearing' && ['␣', ear === 'recording' ? w('done') : w('talk')], ear === 'idle' && ['T', w('type')], strip && ['TAB', panel.title], ['ESC', w('back')]]
    : toPanel
    ? [['ESC', `🧱 ${w('buttons')}`]]
    : [['⏎', w('choose')], screen === 'home' && ['␣', `🎤 ${w('sayIt')}`], (split || strip) && ['TAB', panel.title], ['L', `${flag.flag} ${flag.name}`], screen === 'home' ? ['Q', w('quit')] : ['ESC', w('back')]];
  const shownGuide = toPanel || expanded ? null : guide;

  return html`
    <${PressArea} presses=${presses}>
    <${Box} width=${columns} height=${rows} flexDirection="column">
      <${Box} justifyContent="space-between" paddingX=${1}>
        <${Text} color="gray">🧱 Kidex · ${config.name}<//>
        <${Text} color="gray">${cost > 0 ? `$${cost.toFixed(2)}` : ''}<//>
      <//>
      <${Box} flexGrow=${1} flexDirection=${stacked ? 'column' : 'row'}>
        ${showPanel && !expanded && !stacked && html`<${FilesPanel} files=${files} now=${busy ? now : null} lang=${lang} explain=${config.explain} words=${w} />`}
        ${expanded ? html`
          <${Press} on=${leavePanel} width=${stacked ? undefined : COLUMN} height=${stacked ? CARD : undefined} flexShrink=${0} flexDirection="column" alignItems="center" justifyContent="center">
            <${KidexCard} text=${screen === 'pick' ? w('pick') : lastKidex?.text} status=${guide} color=${guideColor} tick=${tick} busy=${busy} width=${stacked ? columns - 2 : COLUMN - 2} />
          <//>` : html`
          <${Press} on=${toPanel ? leavePanel : null} flexGrow=${split ? 0 : 1} flexShrink=${split ? 0 : 1} width=${split && !stacked ? COLUMN : undefined} flexDirection="column" alignItems="center" justifyContent="center">
            ${middle}
          <//>`}
        ${showPanel && !expanded && stacked && html`<${Box} height=${FILES_ROWS} flexShrink=${0} overflow="hidden"><${FilesPanel} files=${files} now=${busy ? now : null} lang=${lang} explain=${config.explain} words=${w} width=${columns} /><//>`}
        ${(split || expanded) && html`
          <${Press} on=${split && panel.code === null ? () => setOnPanel(true) : null} flexShrink=${0}>
            <${TerminalView} panel=${panel} focused=${toPanel} width=${panelWidth} height=${panelHeight} note=${panel.code !== null && w('stopped')} />
          <//>`}
        ${beside && html`<${Press} on=${() => setBig(true)} flexShrink=${0}><${PanelStrip} panel=${panel} width=${stripWidth} height=${stripHeight} open=${w('openIt')} stopped=${w('stopped')} /><//>`}
      <//>
      ${shownGuide && html`<${Box} justifyContent="center"><${Text} bold color=${guideColor}>${shownGuide}<//><//>`}
      <${Box} justifyContent="center" gap=${3}>
        ${hints.filter(Boolean).map(([k, v]) => html`<${Text} key=${k} color="gray"><${Text} inverse bold> ${k} <//> ${v}<//>`)}
      <//>
      ${party && html`<${Confetti} big=${party.big} name=${party.name} title=${w('madeIt')} tick=${tick} columns=${columns} rows=${rows} />`}
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

function Tiles({ items, sel, columns, small, onPress }) {
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
              <${Press} key=${i} on=${onPress && (() => onPress(i))} width=${width} height=${small ? 5 : 7} borderStyle=${on ? 'bold' : 'round'} borderColor=${on ? 'whiteBright' : color}
                backgroundColor=${on ? color : undefined} flexDirection="column" alignItems="center" justifyContent="center" paddingX=${1}>
                ${emoji && html`<${Text}>${emoji}<//>`}
                <${Text} bold color=${on ? 'black' : color} wrap="wrap">${text}<//>
              <//>`;
          })}
        <//>`)}
    <//>`;
}

const COLUMN = 28;
const STRIP = 30;
const NARROW = 90; // narrower than this, and tall enough, the parts stack
const CARD = 8; // the Kidex card's rows above a big program, when stacked
const FILES_ROWS = 12; // the files panel's rows under Kidex, when stacked

/** The buttons in rows across the screen, above a panel program: each as wide as the longest. */
function rowOf(items, columns) {
  const width = Math.min(COLUMN - 2, Math.max(...items.map(i => i.text.length)) + 7); // emoji, space, border, padding
  const across = Math.max(1, Math.floor(columns / width));
  return { width, across, height: Math.ceil(items.length / across) * 3 };
}

/**
 * The panel program on the right while kids build: its whole screen, laid out for this width
 * (its terminal is resized to fit), under its title. TAB opens it.
 */
function PanelStrip({ panel, width, height, open, stopped }) {
  const running = panel.code === null;
  return html`
    <${Box} width=${width} height=${height} flexDirection="column" borderStyle="round" borderColor="gray">
      <${Text} bold wrap="truncate-end"> ${running ? html`<${Text} color="green">●<//>` : html`<${Text} color="yellow">■<//>`} ${panel.title}<//>
      <${Box} flexDirection="column" flexGrow=${1} overflow="hidden">
        ${panel.lines.slice(0, height - STRIP_CHROME).map((l, i) => html`<${Text} key=${i} wrap="truncate-end">${l}<//>`)}
      <//>
      <${Text} color=${running ? 'gray' : 'yellow'} wrap="truncate-end"> <${Text} inverse bold> TAB <//> ${running ? open : stopped}<//>
    <//>`;
}

const STRIP_CHROME = 4; // the strip's border, title and TAB line

/** Kidex, small, while the panel program is big: what Kidex said last, and whose turn it is. */
function KidexCard({ text, status, color, tick, busy, width }) {
  return html`
    <${Box} width=${width} flexDirection="column" borderStyle="round" borderColor=${color} paddingX=${1}>
      <${Text} bold>🧱 Kidex ${busy ? ['⛏️ ', ' ⛏️'][tick % 2] : ''}<//>
      ${text && html`<${Text} color="whiteBright" wrap="wrap">${text.length > 140 ? text.slice(0, 139) + '…' : text}<//>`}
      ${status && html`<${Box} marginTop=${1}><${Text} color=${color} wrap="wrap">${status}<//><//>`}
    <//>`;
}

/**
 * The buttons as one short column beside a panel program, or in rows above it (row from rowOf).
 * sel -1: none chosen, the keys go to the program.
 */
function Column({ items, sel, row, onPress }) {
  return html`
    <${Box} flexDirection=${row ? 'row' : 'column'} flexWrap=${row ? 'wrap' : 'nowrap'} justifyContent="center" alignItems="center">
      ${items.map(({ emoji, text }, i) => {
        const on = i === sel;
        const color = COLORS[i % COLORS.length];
        return html`
          <${Press} key=${i} on=${() => onPress(i)} width=${row ? row.width : COLUMN - 2} borderStyle=${on ? 'bold' : 'round'} borderColor=${on ? 'whiteBright' : sel < 0 ? 'gray' : color}
            backgroundColor=${on ? color : undefined} paddingX=${1}>
            <${Text} bold color=${on ? 'black' : sel < 0 ? 'gray' : color} wrap="truncate-end">${emoji} ${text}<//>
          <//>`;
      })}
    <//>`;
}

// What Kidex says looks different when it's a bug (a puzzle to solve) or a fix (a win).
const MOODS = {
  error: { icon: '😕', color: 'yellow' },
  bug: { icon: '🐛', color: 'magentaBright' },
  fixed: { icon: '🔧', color: 'greenBright' },
};

function Bubble({ children, kind, detail, width, tight }) {
  const { icon, color } = MOODS[kind] ?? { icon: '🤖', color: 'whiteBright' };
  return html`
    <${Box} borderStyle=${kind === 'bug' || kind === 'fixed' ? 'double' : 'round'} borderColor=${color} paddingX=${2} paddingY=${tight ? 0 : 1} marginY=${tight ? 0 : 1} width=${width} flexDirection="column" alignItems="center">
      <${Text} bold color=${color}>${icon} ${children}<//>
      ${detail && html`<${Text} color="gray" dimColor wrap="truncate-end">${detail}<//>`}
    <//>`;
}

/** The plan's steps: ✅ done, 👉 now, ⬜ still to do. at -1: just the list, before it starts. */
function Checklist({ steps, at, tick = 0, title, short }) {
  if (short) {
    // One line, when the screen is busy with a quiz: the ticks, and the step being worked on.
    const marks = steps.map((s, i) => i < at ? '✅' : i === at ? '👉' : '⬜').join('');
    const now = steps[Math.min(at, steps.length - 1)];
    return html`<${Box} marginTop=${1}><${Text} color="yellowBright">${marks}  ${now.emoji} ${now.text}<//><//>`;
  }
  return html`
    <${Box} flexDirection="column" marginTop=${1} borderStyle="round" borderColor="gray" paddingX=${2}>
      ${title && html`<${Text} bold color="gray">📋 ${title}<//>`}
      ${steps.map((s, i) => {
        const done = at >= 0 && i < at;
        const now = i === at;
        const mark = at < 0 ? `${i + 1}.` : done ? '✅' : now ? (tick % 2 ? '👉' : ' 👉') : '⬜';
        return html`<${Text} key=${i} bold=${now} color=${done ? 'green' : now ? 'yellowBright' : at < 0 ? 'white' : 'gray'}>${mark} ${s.emoji} ${s.text}<//>`;
      })}
    <//>`;
}

/** A small question while Kidex works. After an answer: right or not, and why. */
function Quiz({ quiz, title, words, width, onPress }) {
  const answered = quiz.picked !== null;
  const right = quiz.picked === quiz.answer;
  return html`
    <${Box} flexDirection="column" alignItems="center" marginTop=${1} borderStyle="round" borderColor="cyan" paddingX=${2} width=${width}>
      <${Text} color="cyan">🤔 ${title}<//>
      <${Text} bold color="cyanBright" wrap="wrap">${quiz.question}<//>
      <${Box} flexDirection="column" marginTop=${1}>
        ${quiz.choices.map((c, i) => {
          const on = !answered && i === quiz.sel;
          const mark = answered ? (i === quiz.answer ? '✅' : i === quiz.picked ? '❌' : '  ') : on ? '▶ ' : '  ';
          const color = answered ? (i === quiz.answer ? 'green' : i === quiz.picked ? 'red' : 'gray') : on ? 'black' : 'cyan';
          return html`<${Press} key=${i} on=${!answered && onPress && (() => onPress(i))}>
            <${Text} bold=${on || (answered && i === quiz.answer)} color=${color} backgroundColor=${on ? 'cyan' : undefined}>${mark} ${i + 1}. ${c} <//>
          <//>`;
        })}
      <//>
      ${answered && html`<${Box} marginTop=${1}><${Text} color=${right ? 'greenBright' : 'yellow'} wrap="wrap">${right ? '🎉' : '💡'} ${words(right ? 'correct' : 'notQuite')} ${quiz.explain}<//><//>`}
    <//>`;
}

/** A big mic that gently pulses while Kidex waits for the kid to talk. */
function Mic({ tick, onPress }) {
  const on = tick % 4 < 2;
  return html`
    <${Press} on=${onPress} marginTop=${1} borderStyle=${on ? 'bold' : 'round'} borderColor=${on ? 'greenBright' : 'green'} paddingX=${2}>
      <${Text} bold color=${on ? 'greenBright' : 'green'}>🎤 ${on ? '·))' : '·) '}<//>
    <//>`;
}

/** How loud the kid is: a bar that moves when they talk, so they can see the mic hears them. */
function Meter({ level }) {
  const width = 24;
  const n = Math.round(level * width);
  const color = level > 0.85 ? 'red' : level > 0.15 ? 'greenBright' : 'gray';
  return html`<${Text}><${Text} color=${color}>${'█'.repeat(n)}<//><${Text} color="gray">${'░'.repeat(width - n)}<//><//>`;
}

/**
 * Confetti falling over the whole screen. big: a "You made it!" banner too.
 * Each piece is placed on its own, so the screen under it stays visible.
 */
const PIECES = ['●', '■', '▲', '◆', '★', '✦', '✿', '♥'];
const PARTY_COLORS = ['redBright', 'yellowBright', 'greenBright', 'cyanBright', 'magentaBright', 'blueBright'];
function Confetti({ big, name, title, tick, columns, rows }) {
  const count = Math.round((columns * rows) / (big ? 45 : 140));
  const pieces = [];
  for (let i = 0; i < count; i++) {
    const r = seeded(i);
    const x = Math.floor(r() * columns + Math.sin((tick + i) / 3) * 2);
    const y = Math.floor(r() * rows * 1.5 + tick * (0.6 + r() * 0.8)) % (rows + 2) - 2;
    if (x < 0 || x >= columns - 1 || y < 0 || y >= rows) continue;
    pieces.push(html`<${Box} key=${i} position="absolute" left=${x} top=${y}>
      <${Text} color=${PARTY_COLORS[i % PARTY_COLORS.length]} bold>${PIECES[Math.floor(r() * PIECES.length)]}<//>
    <//>`);
  }
  const width = Math.min(44, columns - 4);
  return html`
    <${Box} position="absolute" left=${0} top=${0} width=${columns} height=${rows}>
      ${pieces}
      ${big && html`
        <${Box} position="absolute" left=${Math.floor((columns - width) / 2)} top=${Math.max(0, Math.floor(rows / 2) - 4)}
          width=${width} borderStyle="double" borderColor=${PARTY_COLORS[tick % PARTY_COLORS.length]} backgroundColor="black"
          flexDirection="column" alignItems="center" paddingY=${1}>
          <${Text} bold color="yellowBright">🎉 ${title} 🎉<//>
          ${name && html`<${Text} bold color="whiteBright">✨ ${name} ✨<//>`}
        <//>`}
    <//>`;
}

/** The same random numbers for the same piece every frame, so pieces fall instead of jumping. */
function seeded(seed) {
  let a = seed * 2654435761 + 1;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
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
function FilesPanel({ files, now, lang, explain, words, width = PANEL }) {
  const list = Object.entries(files).sort((a, b) => a[0].localeCompare(b[0])).slice(-14);
  const byDir = {};
  for (const [file, info] of list) {
    const dir = path.dirname(file);
    (byDir[dir] ??= []).push({ file, ...info });
  }
  const short = d => d === '.' ? '' : d.split('/').slice(-2).join('/') + '/';
  const about = now && describe(now.file, lang, explain);
  const code = now && now.action !== 'read' && now.action !== 'draw' ? peek(now.content, { width: width - 6 }) : [];
  return html`
    <${Box} width=${width} flexDirection="column" borderStyle="round" borderColor="gray" paddingX=${1} marginRight=${width === PANEL ? 1 : 0}>
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
