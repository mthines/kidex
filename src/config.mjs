// Reads kidex.json from the project folder. Everything has a default, so a
// project without one still works (with only "look" commands allowed).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DEFAULT_ACTIONS = [
  { id: 'new', emoji: '✨', label: { en: 'Make something new', da: 'Lav noget nyt' }, prompt: 'The kid wants to make something new.' },
  { id: 'change', emoji: '🔧', label: { en: 'Change something', da: 'Lav noget om' }, prompt: 'The kid wants to change something that already exists.' },
  { id: 'ask', emoji: '❓', label: { en: 'Ask a question', da: 'Stil et spørgsmål' }, prompt: 'The kid has a question. Answer it; do not change any files.' },
];

export const DEFAULTS = {
  name: null,
  language: 'auto', // "da", "en" or "auto" (follow whatever the kid speaks)
  voices: {}, // per language: "piper:<voice>" or a macOS voice name; empty picks the best installed
  model: 'claude-opus-5-5',
  effort: 'medium',
  budgetUsd: 3,
  instructions: '',
  check: null,
  allow: [],
  deny: [],
  actions: DEFAULT_ACTIONS,
  start: null, // the id of the button selected when the start screen opens; null: the first
  talk: { prompt: '', now: [] }, // SPACE on the start screen: the kid just says what they want
  git: { branch: null, commit: false },
};

export function loadConfig(cwd) {
  const file = path.join(cwd, 'kidex.json');
  let raw = {};
  if (fs.existsSync(file)) {
    try {
      raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (e) {
      throw new Error(`kidex.json is not valid JSON: ${e.message}`);
    }
  }
  const config = {
    ...DEFAULTS,
    ...raw,
    voices: { ...DEFAULTS.voices, ...raw.voices },
    git: { ...DEFAULTS.git, ...raw.git },
    talk: { ...DEFAULTS.talk, ...raw.talk },
    name: raw.name ?? path.basename(cwd),
    file: fs.existsSync(file) ? file : null,
  };
  config.actions = config.actions.map((a, i) => ({ id: a.id ?? String(i), emoji: a.emoji ?? '⭐', ...a }));
  config.talk = talkAction(config.talk);
  return config;
}

const TALK_PROMPT = `The kid pressed space on the start screen and just said what they want, without picking a button. Work out what they mean, and do it:
- Something a command below does right away (like giving them things in the game): run it at once, with no questions and no show_plan, then call all_done with quick true. Only ask (ask_kid) if you really cannot tell what they mean.
- Making something new or changing something: do it the usual way (a question or two, show_plan, build, check).
- A question: answer it with tell_kid in one to three short sentences and change nothing, then call all_done with quick true.`;

/** The action SPACE starts on the start screen: kidex.json's "talk" says what Claude may do right away ("now"). */
function talkAction(talk) {
  const now = talk.now ?? [];
  return {
    id: 'talk', emoji: '🎤', label: { en: 'Say it', da: 'Sig det' }, ...talk, now,
    prompt: [
      TALK_PROMPT,
      now.length ? `Commands you may run right away, without a plan: ${now.join(', ')}.` : 'There are no commands you may run right away here.',
      talk.prompt,
    ].filter(Boolean).join('\n'),
  };
}

/** What a session for this action runs with: an action can bring its own commands-right-away, model, and effort. */
export function sessionConfig(config, action, more) {
  return {
    ...config, ...more,
    now: action?.now ?? [],
    model: action?.model ?? config.model,
    effort: action?.effort ?? config.effort,
  };
}

// Choices made inside Kidex (like the language), kept per computer, not per project.
const SETTINGS = path.join(process.env.KIDEX_HOME ?? path.join(os.homedir(), '.kidex'), 'settings.json');

export function loadSettings() {
  try { return JSON.parse(fs.readFileSync(SETTINGS, 'utf8')); } catch { return {}; }
}

export function saveSettings(changes) {
  const next = { ...loadSettings(), ...changes };
  fs.mkdirSync(path.dirname(SETTINGS), { recursive: true });
  fs.writeFileSync(SETTINGS, JSON.stringify(next, null, 2) + '\n');
  return next;
}

/** A label can be a string or {da, en}. */
export function text(value, lang) {
  if (value == null || typeof value === 'string') return value ?? '';
  return value[lang] ?? value.en ?? Object.values(value)[0];
}

/** "addons/*" → the folder names in addons/, for an action that picks one thing first. */
export function pickChoices(cwd, pattern) {
  const dir = pattern.replace(/\/?\*$/, '');
  const abs = path.join(cwd, dir);
  if (!fs.existsSync(abs)) return [];
  return fs.readdirSync(abs, { withFileTypes: true })
    .filter(d => d.isDirectory() && !d.name.startsWith('.'))
    .map(d => d.name)
    .sort();
}

export function fill(template, vars) {
  return String(template ?? '').replace(/\{(\w+)\}/g, (m, k) => vars[k] ?? m);
}
