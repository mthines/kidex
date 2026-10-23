#!/usr/bin/env node
// kidex [folder]            open Kidex on a project (default: this folder)
// kidex doctor              check the microphone, speech, and voices
// kidex setup               download the speech model (~470 MB)
// kidex setup voice [da en]  install Piper, an open-source voice that runs on this Mac (default: da)
// kidex run [folder] --say "make a cake" [--action new] [--pick name]
//                           no screen: answers every question with the first
//                           choice and says yes to the plan (for testing)

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadConfig } from '../src/config.mjs';
import { abilities, bestVoice, piperModel, MODEL, MODEL_URL, PIPER_PYTHON, PIPER_VOICES, VOICES } from '../src/voice.mjs';

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
  const langs = cfg.language === 'auto' ? ['da', 'en'] : [cfg.language];
  const better = [];
  for (const lang of langs) {
    const model = piperModel(lang, cfg.voices[lang]);
    if (model) { row(true, `voice for ${lang}: Piper ${path.basename(model, '.onnx')}`); continue; }
    const v = bestVoice(lang, cfg.voices[lang]);
    const good = v && /\((Premium|Enhanced)\)/.test(v);
    row(Boolean(v), `voice for ${lang}: ${v ?? 'none'}${v && !good ? ' (basic)' : ''}`, 'see below');
    if (!good) better.push(lang);
  }
  if (better.length) {
    console.log(`\nFor a better voice in ${better.join(' and ')}, install a free, open-source Piper voice (runs on this Mac):
  kidex setup voice ${better.join(' ')}
Or download an Enhanced/Premium macOS voice, if Apple has one for the language: System Settings → Accessibility →
Read & Speak → the ⓘ to the right of "System voice". (Apple has none for Danish.)`);
  }
  console.log(`\nProject: ${cfg.name} ${cfg.file ? `(${cfg.file})` : '(no kidex.json: only looking is allowed)'}`);
  console.log('The first time you talk, macOS asks to let your terminal use the microphone. Say yes.');
}

function setup() {
  if (args[0] === 'voice') return setupVoice(args.slice(1));
  if (fs.existsSync(MODEL)) { console.log(`Already there: ${MODEL}`); return; }
  fs.mkdirSync(path.dirname(MODEL), { recursive: true });
  console.log(`Downloading the speech model (~470 MB) to ${MODEL}`);
  const r = spawnSync('curl', ['-L', '--fail', '-o', MODEL, MODEL_URL], { stdio: 'inherit' });
  if (r.status !== 0) { fs.rmSync(MODEL, { force: true }); process.exit(1); }
}

/**
 * kidex setup voice [da en ...]: Piper in its own Python environment under
 * ~/.kidex/piper, plus espeak-ng (Piper's own copy is broken on macOS), plus the voices.
 */
function setupVoice(langs) {
  const run = (cmd, a, opts = {}) => {
    console.log(`→ ${cmd} ${a.join(' ')}`);
    const r = spawnSync(cmd, a, { stdio: 'inherit', ...opts });
    if (r.status !== 0) { console.error(`\n❌ That failed: ${cmd} ${a.join(' ')}`); process.exit(1); }
  };
  const has = c => spawnSync('sh', ['-c', `command -v ${c}`]).status === 0;
  const names = (langs.length ? langs : ['da']).map(l => PIPER_VOICES[l] ?? l);

  if (!has('espeak-ng')) {
    if (!has('brew')) { console.error('Kidex needs espeak-ng: install Homebrew (https://brew.sh), then run this again.'); process.exit(1); }
    run('brew', ['install', 'espeak-ng']);
  }
  if (!fs.existsSync(PIPER_PYTHON)) {
    const venv = path.dirname(path.dirname(PIPER_PYTHON));
    if (has('uv')) run('uv', ['venv', '-q', '--python', '3.11', venv]);
    else run('python3', ['-m', 'venv', venv]);
  }
  if (spawnSync(PIPER_PYTHON, ['-c', 'import piper']).status !== 0) {
    if (has('uv')) run('uv', ['pip', 'install', '-q', '--python', PIPER_PYTHON, 'piper-tts==1.8.0']);
    else run(PIPER_PYTHON, ['-m', 'pip', 'install', '-q', 'piper-tts==1.8.0']);
  }
  fs.mkdirSync(VOICES, { recursive: true });
  run(PIPER_PYTHON, ['-m', 'piper.download_voices', '--data-dir', VOICES, ...names]);
  console.log(`\n✅ Kidex now talks with Piper: ${names.join(', ')}. Restart Kidex to hear it.`);
}
