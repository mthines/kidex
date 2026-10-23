#!/usr/bin/env node
// kidex [folder]            open Kidex on a project (default: this folder)
// kidex doctor              check the microphone, speech, and voices
// kidex setup               download the speech model (~470 MB)
// kidex run [folder] --say "make a cake" [--action new] [--pick name]
//                           no screen: answers every question with the first
//                           choice and says yes to the plan (for testing)

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadConfig } from '../src/config.mjs';
import { abilities, bestVoice, MODEL, MODEL_URL } from '../src/voice.mjs';

const args = process.argv.slice(2);
const flag = name => { const i = args.indexOf(`--${name}`); return i >= 0 ? args.splice(i, 2)[1] : undefined; };
const bool = name => { const i = args.indexOf(`--${name}`); return i >= 0 ? (args.splice(i, 1), true) : false; };
const cmd = ['doctor', 'setup', 'run'].includes(args[0]) ? args.shift() : 'open';

if (cmd === 'doctor') doctor();
else if (cmd === 'setup') setup();
else if (cmd === 'run') await headless();
else await open();

async function open() {
  const quiet = bool('quiet');
  const cwd = path.resolve(args[0] ?? '.');
  const config = loadConfig(cwd);
  const { render } = await import('ink');
  const React = (await import('react')).default;
  const { App } = await import('../src/ui.mjs');
  const app = render(React.createElement(App, { cwd, config, quiet }), { exitOnCtrlC: true, alternateScreen: true });
  await app.waitUntilExit();
  process.exit(0);
}

async function headless() {
  const words = flag('say');
  const actionId = flag('action');
  const pick = flag('pick');
  const cwd = path.resolve(args[0] ?? '.');
  const config = loadConfig(cwd);
  const action = config.actions.find(a => a.id === actionId) ?? config.actions[0];
  if (!words) { console.error('kidex run needs --say "what the kid says"'); process.exit(2); }
  const { createSession } = await import('../src/session.mjs');
  let finished;
  const done = new Promise(r => { finished = r; });
  let ok = false;
  const session = createSession({
    cwd, config, onEvent(e) {
      console.log(JSON.stringify(e));
      if (e.type === 'ask') setTimeout(() => session.answer(e.choices[0] ?? 'You choose!'));
      if (e.type === 'plan') setTimeout(() => session.answer('👍'));
      if (e.type === 'done') ok = true;
      if (e.type === 'turn' || e.type === 'error') finished();
    },
  });
  session.start({ action, pick, words, lang: config.language });
  await done;
  await session.stop();
  process.exit(ok ? 0 : 1);
}

function doctor() {
  const a = abilities();
  const row = (ok, what, fix) => console.log(`${ok ? '✅' : '❌'} ${what}${ok || !fix ? '' : `  →  ${fix}`}`);
  row(a.record, 'ffmpeg (records the microphone)', 'brew install ffmpeg');
  row(Boolean(a.whisper), 'whisper.cpp (turns talking into text)', 'brew install whisper-cpp');
  row(a.model, `speech model (${MODEL})`, 'kidex setup');
  row(a.speak, 'say (talks back)', 'Kidex talks with macOS `say`');
  const cfg = loadConfig(path.resolve(args[0] ?? '.'));
  const better = [];
  for (const [lang, preferred] of Object.entries(cfg.voices)) {
    const v = bestVoice(lang, preferred);
    const good = v && /\((Premium|Enhanced)\)/.test(v);
    row(Boolean(v), `voice for ${lang}: ${v ?? 'none'}${v && !good ? ' (basic: a better one can be downloaded)' : ''}`, 'see below');
    if (!good) better.push(lang);
  }
  if (better.length) {
    const names = { da: 'Dansk', en: 'English' };
    console.log(`\nBetter voices are free from Apple, but only through System Settings (no program can download them):
  1. System Settings → Accessibility → Spoken Content
  2. Next to "System voice", click the ⓘ (or "Manage Voices…")
  3. Find ${better.map(l => names[l] ?? l).join(' and ')}, and click ⬇ next to a voice marked Premium (best) or Enhanced
  4. When it has downloaded, Kidex uses it by itself. No need to change kidex.json.`);
  }
  console.log(`\nProject: ${cfg.name} ${cfg.file ? `(${cfg.file})` : '(no kidex.json: only looking is allowed)'}`);
  console.log('The first time you talk, macOS asks to let your terminal use the microphone. Say yes.');
}

function setup() {
  if (fs.existsSync(MODEL)) { console.log(`Already there: ${MODEL}`); return; }
  fs.mkdirSync(path.dirname(MODEL), { recursive: true });
  console.log(`Downloading the speech model (~470 MB) to ${MODEL}`);
  const r = spawnSync('curl', ['-L', '--fail', '-o', MODEL, MODEL_URL], { stdio: 'inherit' });
  if (r.status !== 0) { fs.rmSync(MODEL, { force: true }); process.exit(1); }
}
