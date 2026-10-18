"""Records the voice lines for the HotelOne reel with Kokoro-82M (offline TTS).

Reads src/script.json and writes one WAV per line to public/vo/ plus the
measured durations and caption-chunk timings to src/vo.ts. The WAVs and
vo.ts are committed, so rendering the video needs neither this script nor
the model.

    python -I scripts/make-voice.py --model model_quantized.onnx --voices voices.npz

Model: Kokoro-82M v1.0 ONNX, q8 (onnx-community/Kokoro-82M-v1.0-ONNX,
onnx/model_quantized.onnx, sha256 fbae9257...a1478). voices.npz holds the
English voice style arrays (510x1x256 float32 per voice) keyed by name, as
shipped in voices/*.bin of the kokoro-js npm package. Requires
`pip install kokoro-onnx==0.6.1 soundfile`.

Each sentence is synthesized on its own (natural prosody), trimmed of the
model's leading and trailing silence, and the sentences of a line are joined
with a fixed gap, so every sentence boundary is exact. The model reports no
durations, so word times inside a sentence are estimated: speech runs are
found from the audio energy, words are grouped at punctuation (where the
model pauses), and inside a run each word gets time in proportion to its
phoneme count. Caption chunks take the span of their words.
"""

import argparse
import json
import pathlib
import re

import numpy as np
import soundfile as sf
from kokoro_onnx import Kokoro

ROOT = pathlib.Path(__file__).resolve().parent.parent
SR = 24000
HOP = 240  # 10 ms
PAD = 0.03  # silence kept around each trimmed sentence (s)


def rms_frames(audio: np.ndarray) -> np.ndarray:
    frames = len(audio) // HOP
    return np.array([np.sqrt(np.mean(audio[i * HOP:(i + 1) * HOP] ** 2) + 1e-12) for i in range(frames)])


def speech_runs(audio: np.ndarray) -> list[tuple[float, float]]:
    """Spans (s) where the voice is active; gaps under 140 ms are bridged."""
    rms = rms_frames(audio)
    active = rms > rms.max() * 10 ** (-38 / 20)
    runs, start = [], None
    for i, a in enumerate(active):
        if a and start is None:
            start = i
        if not a and start is not None:
            runs.append([start, i])
            start = None
    if start is not None:
        runs.append([start, len(active)])
    merged = []
    for r in runs:
        if merged and r[0] - merged[-1][1] < 14:
            merged[-1][1] = r[1]
        else:
            merged.append(r)
    merged = [r for r in merged if r[1] - r[0] >= 4]
    return [(r[0] * HOP / SR, r[1] * HOP / SR) for r in merged]


def trim(audio: np.ndarray) -> np.ndarray:
    runs = speech_runs(audio)
    s = max(0, int((runs[0][0] - PAD) * SR))
    e = min(len(audio), int((runs[-1][1] + PAD) * SR))
    return audio[s:e]


def word_timings(kokoro: Kokoro, text: str, audio: np.ndarray) -> list[dict]:
    words = text.split()
    weights = []
    for w in words:
        bare = re.sub(r"[^\w']", "", w)
        ph = kokoro.tokenizer.phonemize(bare) if bare else ""
        weights.append(max(1, len(ph.replace(" ", ""))))
    groups, cur = [], []
    for i, w in enumerate(words):
        cur.append(i)
        if re.search(r"[.,!?;:—…]\W*$", w) or w.endswith("..."):
            groups.append(cur)
            cur = []
    if cur:
        groups.append(cur)
    # A lone dash or ellipsis word carries no sound: fold it into the previous group.
    groups = [g for g in groups if any(re.search(r"\w", words[i]) for i in g)] or [list(range(len(words)))]

    runs = speech_runs(audio)
    if len(runs) != len(groups):
        runs = [(runs[0][0], runs[-1][1])]
        groups = [list(range(len(words)))]

    out = []
    for (s, e), g in zip(runs, groups):
        total = sum(weights[i] for i in g)
        t = s
        for i in g:
            d = (e - s) * weights[i] / total
            out.append({"word": words[i], "start": round(t, 3), "end": round(t + d, 3)})
            t += d
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", required=True)
    ap.add_argument("--voices", required=True)
    ap.add_argument("--only", nargs="*", help="re-record just these line ids")
    args = ap.parse_args()

    script = json.loads((ROOT / "src" / "script.json").read_text())
    kokoro = Kokoro(args.model, args.voices)
    out_dir = ROOT / "public" / "vo"
    out_dir.mkdir(parents=True, exist_ok=True)
    vo_path = ROOT / "src" / "vo.ts"

    manifest = {}
    if args.only and vo_path.exists():
        prev = vo_path.read_text()
        manifest = json.loads(prev[prev.index("{"):prev.rindex("}") + 1])

    gap_default = script.get("sentenceGap", 0.12)
    for line in script["lines"]:
        if args.only and line["id"] not in args.only:
            continue
        cast = script["voices"][line["role"]]
        speed = line.get("speed", cast["speed"])
        gap = line.get("gap", gap_default)
        pieces, words, chunks = [], [], []
        t = 0.0
        for si, sentence in enumerate(line["sentences"]):
            text = sentence["text"]
            audio, sr = kokoro.create(text, voice=cast["voice"], speed=speed, lang=cast.get("lang", "en-us"))
            assert sr == SR
            audio = trim(audio.astype(np.float32))
            sw = word_timings(kokoro, text, audio)
            for w in sw:
                words.append({"word": w["word"], "start": round(t + w["start"], 3), "end": round(t + w["end"], 3)})
            # Caption chunks: consecutive word spans, in the order given.
            chunk_texts = sentence.get("chunks") or [text]
            wi = 0
            for ct in chunk_texts:
                n = len(ct.split())
                span = sw[wi:wi + n]
                assert span and " ".join(x["word"] for x in span) == ct, f"{line['id']}: chunk {ct!r} does not match the sentence words"
                chunks.append({"text": ct, "start": round(t + span[0]["start"], 3), "end": round(t + span[-1]["end"], 3)})
                wi += n
            assert wi == len(sw), f"{line['id']}: chunks don't cover sentence {text!r}"
            pieces.append(audio)
            t += len(audio) / SR
            if si < len(line["sentences"]) - 1:
                pieces.append(np.zeros(int(gap * SR), dtype=np.float32))
                t += gap
        audio = np.concatenate(pieces)
        audio = audio / float(np.abs(audio).max()) * 0.89  # -1 dBFS; the mix sets the final level
        sf.write(out_dir / f"{line['id']}.wav", audio, SR, subtype="PCM_16")
        manifest[line["id"]] = {
            "role": line["role"],
            "text": " ".join(s["text"] for s in line["sentences"]),
            "duration": round(len(audio) / SR, 3),
            "chunks": chunks,
            "words": words,
        }
        print(f"{line['id']:10s} {len(audio) / SR:5.2f}s  {manifest[line['id']]['text']}")

    ordered = {l["id"]: manifest[l["id"]] for l in script["lines"] if l["id"] in manifest}
    vo_path.write_text(
        "// Generated by scripts/make-voice.py. Do not edit by hand.\n"
        "export const VO = " + json.dumps(ordered, indent=1, ensure_ascii=False) + " as const;\n\n"
        "export type LineId = keyof typeof VO;\n"
    )
    total = sum(m["duration"] for m in ordered.values())
    print(f"{len(ordered)} lines, {total:.1f}s of speech")


if __name__ == "__main__":
    main()
