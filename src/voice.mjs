// Ears and mouth: record the mic with ffmpeg, turn it into text with
// whisper.cpp, and read answers out loud with macOS `say`.

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const HOME = process.env.KIDEX_HOME ?? path.join(os.homedir(), '.kidex');
export const MODEL = process.env.KIDEX_WHISPER_MODEL ?? path.join(HOME, 'models', 'ggml-small.bin');
export const MODEL_URL = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin';

const has = cmd => spawnSync('sh', ['-c', `command -v ${cmd}`]).status === 0;
const whisperBin = () => ['whisper-cli', 'whisper-cpp'].find(has);

/** What works on this machine, for `kidex doctor` and for picking typing over talking. */
export function abilities() {
  return {
    record: has('ffmpeg'),
    transcribe: Boolean(whisperBin()) && fs.existsSync(MODEL),
    whisper: whisperBin() ?? null,
    model: fs.existsSync(MODEL),
    speak: has('say'),
  };
}

/** Start recording. Call stop() on the result to get the wav file. */
export function startRecording() {
  const file = path.join(os.tmpdir(), `kidex-${process.pid}-${Date.now()}.wav`);
  const mic = process.env.KIDEX_MIC ?? ':default';
  const ff = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'avfoundation', '-i', mic, '-ac', '1', '-ar', '16000', file], { stdio: ['pipe', 'ignore', 'pipe'] });
  let err = '';
  ff.stderr.on('data', d => { err += d; });
  const done = new Promise(resolve => ff.on('close', resolve));
  return {
    file,
    async stop() {
      ff.stdin.write('q'); // ffmpeg finishes the file cleanly on "q"
      ff.stdin.end();
      const t = setTimeout(() => ff.kill('SIGINT'), 2000);
      await done;
      clearTimeout(t);
      if (!fs.existsSync(file) || fs.statSync(file).size < 1000) {
        throw new Error(`The microphone did not record anything. ${err.trim()}`);
      }
      return file;
    },
    cancel() { ff.kill('SIGKILL'); fs.rmSync(file, { force: true }); },
  };
}

/** wav → text. lang: "da", "en" or "auto". */
export function transcribe(file, lang = 'auto') {
  const bin = whisperBin();
  if (!bin) return Promise.reject(new Error('whisper.cpp is missing: brew install whisper-cpp'));
  return new Promise((resolve, reject) => {
    const args = ['-m', MODEL, '-l', lang, '-nt', '-np', '-f', file];
    const p = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    p.stdout.on('data', d => { out += d; });
    p.stderr.on('data', d => { err += d; });
    p.on('close', code => {
      fs.rmSync(file, { force: true });
      if (code !== 0) return reject(new Error(`whisper failed: ${err.trim().split('\n').pop()}`));
      resolve(cleanTranscript(out));
    });
  });
}

/** Whisper marks silence and noise like "[BLANK_AUDIO]" or "(music)". */
export function cleanTranscript(s) {
  return s.replace(/\[[^\]]*\]|\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
}

let installed = null;

/** The voices `say` has, as [{name, locale}]. */
export function voiceList() {
  if (installed) return installed;
  const out = spawnSync('say', ['-v', '?'], { encoding: 'utf8' }).stdout ?? '';
  installed = out.split('\n').map(l => /^(.+?)\s{2,}([a-z]{2,3}_[A-Z0-9]{2,3})\s+#/.exec(l)).filter(Boolean)
    .map(m => ({ name: m[1].trim(), locale: m[2] }));
  return installed;
}

/**
 * The best installed voice for a language: Premium, then Enhanced, then plain.
 * `preferred` (from kidex.json) wins when it is installed; its better versions
 * ("Sara (Premium)") are taken over the plain one.
 */
export function bestVoice(lang, preferred, list = voiceList()) {
  preferred ||= PLAIN[lang];
  const mine = list.filter(v => v.locale.startsWith(lang + '_') && !NOVELTY.has(v.name));
  const rank = v => (/\(Premium\)/.test(v.name) ? 0 : /\(Enhanced\)/.test(v.name) ? 1 : 2) + (preferred && v.name.startsWith(preferred) ? 0 : 0.5);
  return [...mine].sort((a, b) => rank(a) - rank(b))[0]?.name ?? null;
}

// When nothing better is installed: the ordinary voice each language comes with.
const PLAIN = { da: 'Sara', en: 'Samantha' };
// Apple's joke and old robot voices: never picked by themselves.
const NOVELTY = new Set(['Albert', 'Bad News', 'Bahh', 'Bells', 'Boing', 'Bubbles', 'Cellos', 'Good News', 'Jester',
  'Organ', 'Superstar', 'Trinoids', 'Whisper', 'Wobble', 'Zarvox', 'Fred', 'Junior', 'Kathy', 'Ralph']);

// Piper: open-source voices that run on this computer. Optional; `kidex setup voice`
// installs Python + Piper in ~/.kidex/piper and voices in ~/.kidex/voices.
export const PIPER_PYTHON = path.join(HOME, 'piper', 'bin', 'python');
export const VOICES = path.join(HOME, 'voices');
const PIPER_SCRIPT = new URL('./piper_speak.py', import.meta.url).pathname;
export const PIPER_VOICES = { da: 'da_DK-talesyntese-medium', en: 'en_US-lessac-medium' };

/**
 * The Piper voice file to use for a language, or null for macOS `say`.
 * kidex.json can name one ("voices": {"da": "piper:da_DK-talesyntese-medium"})
 * or turn Piper off for a language ("say:Sara", or any plain voice name).
 */
export function piperModel(lang, preferred) {
  if (!fs.existsSync(PIPER_PYTHON) || !has('espeak-ng')) return null;
  if (preferred && !preferred.startsWith('piper:')) return null; // kidex.json asked for a macOS voice
  const wanted = preferred?.startsWith('piper:') ? preferred.slice(6) : null;
  let files = [];
  try { files = fs.readdirSync(VOICES).filter(f => f.endsWith('.onnx')); } catch { return null; }
  const file = wanted ? files.find(f => f === wanted + '.onnx') : files.find(f => f.startsWith(lang + '_'));
  return file ? path.join(VOICES, file) : null;
}

const pipers = new Map(); // model file → running helper

function piper(model) {
  let p = pipers.get(model);
  if (p && !p.dead) return p;
  const proc = spawn(PIPER_PYTHON, [PIPER_SCRIPT, model], { stdio: ['pipe', 'pipe', 'ignore'] });
  const waiting = []; // answers come back in order
  let ready;
  p = { dead: false, ready: new Promise(r => { ready = r; }) };
  let buf = '';
  proc.stdout.on('data', d => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
      if (line === 'ready') ready();
      else waiting.shift()?.(line);
    }
  });
  proc.on('exit', () => { p.dead = true; ready(); while (waiting.length) waiting.shift()('error piper stopped'); });
  proc.on('error', () => { p.dead = true; ready(); });
  p.say = async (text, out) => {
    await p.ready;
    if (p.dead) throw new Error('piper stopped');
    const answer = await new Promise(resolve => { waiting.push(resolve); proc.stdin.write(JSON.stringify({ text, out }) + '\n'); });
    if (answer !== 'ok') throw new Error(answer);
  };
  pipers.set(model, p);
  return p;
}

/** Start a language's Piper voice early, so the first sentence isn't slow. */
export function warmUp(lang, voices = {}) {
  const model = piperModel(lang, voices[lang]);
  if (model) piper(model);
}

let speaking = null;
let turn = 0; // a newer line wins, even while an older one is still being made

/** Read text out loud. A new line cuts off the one before. */
export async function speak(line, { lang = 'en', voices = {}, rate } = {}) {
  hush();
  const mine = ++turn;
  const clean = stripForSpeech(line);
  if (!clean) return;

  const model = piperModel(lang, voices[lang]);
  if (model) {
    const out = path.join(os.tmpdir(), `kidex-say-${process.pid}-${mine}.wav`);
    try {
      await piper(model).say(clean, out);
      if (mine !== turn) return fs.rmSync(out, { force: true });
      return await play('afplay', [out], () => fs.rmSync(out, { force: true }));
    } catch {
      fs.rmSync(out, { force: true });
      if (mine !== turn) return;
      // fall through to macOS say
    }
  }

  if (!has('say')) return;
  const args = [];
  const voice = bestVoice(lang, voices[lang]?.replace(/^say:/, ''));
  if (voice) args.push('-v', voice);
  if (rate) args.push('-r', String(rate));
  args.push(clean);
  return play('say', args);
}

function play(cmd, args, after) {
  const p = spawn(cmd, args, { stdio: 'ignore' });
  speaking = p;
  return new Promise(resolve => p.on('close', () => { if (speaking === p) speaking = null; after?.(); resolve(); }));
}

export function hush() {
  turn++;
  if (speaking) speaking.kill();
  speaking = null;
}

/** Emojis and markdown sound silly when read aloud. */
export function stripForSpeech(s) {
  return String(s ?? '')
    .replace(/[`*_#>]/g, '')
    .replace(/\p{Extended_Pictographic}|️|‍/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Very small guess at the language of a sentence, to pick the voice. */
export function guessLang(s, fallback = 'en') {
  if (/[æøå]/i.test(s)) return 'da';
  const da = (s.toLowerCase().match(/\b(jeg|du|det|og|er|en|et|skal|vil|kan|ikke|hvad|lav|med|til|på)\b/g) ?? []).length;
  const en = (s.toLowerCase().match(/\b(i|you|the|and|is|a|an|will|can|not|what|make|with|to|on)\b/g) ?? []).length;
  if (da > en) return 'da';
  if (en > da) return 'en';
  return fallback;
}
