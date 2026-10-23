"""Kidex's Piper voice: loads one Piper voice once, then turns each line of
JSON on stdin ({"text": ..., "out": "file.wav"}) into a wav file and answers
"ok" (or "error ...") on stdout.

Piper's own text-to-phonemes step is broken in its macOS wheels (it looks for
espeak-ng data on the build machine), so this asks the espeak-ng program for
the phonemes and gives those to the voice instead.
"""

import json
import re
import subprocess
import sys
import wave

import numpy as np
from piper import PiperVoice

voice = PiperVoice.load(sys.argv[1])
RATE = voice.config.sample_rate


def phonemes(sentence: str) -> str:
    ipa = subprocess.run(
        ["espeak-ng", "-v", voice.config.espeak_voice, "-q", "--ipa"],
        input=sentence, capture_output=True, text=True, check=True,
    ).stdout
    # espeak-ng puts each clause on its own line and drops the punctuation;
    # Piper speaks better with the commas back. It also writes the Danish
    # glottal stop as "?", which Piper would read as a question mark.
    end = re.search(r"[.!?]+\s*$", sentence)
    return ", ".join(l.strip() for l in ipa.splitlines() if l.strip()).replace("?", "ʔ") + (end.group(0).strip()[:1] if end else ".")


def synthesize(text: str, out: str) -> None:
    chunks = [np.zeros(int(RATE * 0.1))]
    for sentence in re.findall(r"[^.!?]+[.!?]*", text):
        if not re.search(r"\w", sentence):
            continue
        ids = voice.phonemes_to_ids(list(phonemes(sentence)))
        chunks += [voice.phoneme_ids_to_audio(ids), np.zeros(int(RATE * 0.15))]
    audio = np.concatenate(chunks)
    with wave.open(out, "wb") as f:
        f.setnchannels(1)
        f.setsampwidth(2)
        f.setframerate(RATE)
        f.writeframes((np.clip(audio, -1, 1) * 32767).astype(np.int16).tobytes())


print("ready", flush=True)
for line in sys.stdin:
    try:
        request = json.loads(line)
        synthesize(request["text"], request["out"])
        print("ok", flush=True)
    except Exception as e:  # keep serving the next sentence
        print(f"error {e}".replace("\n", " "), flush=True)
