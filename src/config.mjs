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
    name: raw.name ?? path.basename(cwd),
    file: fs.existsSync(file) ? file : null,
  };
  config.actions = config.actions.map((a, i) => ({ id: a.id ?? String(i), emoji: a.emoji ?? '⭐', ...a }));
  return config;
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
