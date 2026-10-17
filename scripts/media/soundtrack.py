"""Procedural music + SFX (no samples, no copyright) for both videos, synced to the game moments.

Reads .work/segments.json + .work/marks.json, writes .work/soundtrack.wav.
"""
import json, os, numpy as np, wave
WORK = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".work-online" if os.environ.get("ONLINE") == "1" else ".work")
SR = 44100
segs = json.load(open(os.path.join(WORK, "segments.json"))); marks = json.load(open(os.path.join(WORK, "marks.json"))); out = os.path.join(WORK, "soundtrack.wav")
starts = []; t = 0
for s in segs:
    starts.append(t); t += (s['e'] - s['s']) / s['v']
total = t
def src2out(x):
    for s, o in zip(segs, starts):
        if s['s'] <= x <= s['e']: return o + (x - s['s']) / s['v']
    return None
N = int(total * SR) + SR
mix = np.zeros(N)
def env(n, a=0.01, r=0.3):
    e = np.ones(n); na = max(1, int(a * SR)); e[:na] = np.linspace(0, 1, na)
    return e * np.exp(-np.linspace(0, n / SR, n) / r)
def add(t0, sig, vol):
    i = int(t0 * SR)
    if i >= N: return
    sig = sig[: N - i]; mix[i:i + len(sig)] += sig * vol
def note(f, dur, kind='sine', r=0.3):
    n = int(dur * SR); tt = np.arange(n) / SR
    w = 2 / np.pi * np.arcsin(np.sin(2 * np.pi * f * tt)) if kind == 'tri' else np.sin(2 * np.pi * f * tt)
    return w * env(n, 0.01, r)
midi = lambda m: 440 * 2 ** ((m - 69) / 12)
bpm = 92; beat = 60 / bpm
prog = [[48, 52, 55], [45, 48, 52], [41, 45, 48], [43, 47, 50]]
b = 0
while b * beat < total:
    ch = prog[(b // 4) % 4]; tb = b * beat
    if b % 4 == 0:
        for m in ch: add(tb, note(midi(m + 12), beat * 4, 'sine', 2.0), 0.035)
    add(tb, note(midi(ch[0] - 12), beat * 0.9, 'tri', 0.4), 0.16)
    for k in range(2): add(tb + k * beat / 2, note(midi(ch[(b * 2 + k) % 3] + 24), beat / 2, 'sine', 0.18), 0.045)
    if b % 2 == 0:
        n = int(0.15 * SR); tt = np.arange(n) / SR
        add(tb, np.sin(2 * np.pi * (110 * np.exp(-tt * 18) + 40) * tt) * np.exp(-tt * 20), 0.22)
    b += 1
def chime(t0):
    for i, f in enumerate([784, 1047, 1568]): add(t0 + i * 0.06, note(f, 0.6, 'tri', 0.25), 0.18)
def dingdong(t0):
    for f, d in [(659, 0), (523, 0.55)]:
        add(t0 + d, note(f, 1.6, 'sine', 0.7), 0.3); add(t0 + d, note(f * 2, 0.9, 'sine', 0.3), 0.07)
def whoosh(t0):
    n = int(0.45 * SR); w = np.convolve(np.random.randn(n), np.ones(12) / 12, 'same'); add(t0, w * np.hanning(n), 0.12)
def fanfare(t0):
    for f, d in zip([523, 659, 784, 1047, 784, 1047], [0, .12, .24, .36, .6, .72]): add(t0 + d, note(f, 0.3 if d < .7 else 1.0, 'tri', 0.3), 0.13)
def drum(t0, dur=2.4):
    k = 0
    while k * 0.045 < dur:
        n = int(0.06 * SR); add(t0 + k * 0.045, np.random.randn(n) * np.exp(-np.linspace(0, 6, n)), 0.03 + 0.12 * k * 0.045 / dur); k += 1
def at(x, fn):
    o = src2out(x)
    if o is not None: fn(o)
at(marks['GREEN'], chime)
at(marks['CALL'] + 0.05, lambda o: drum(o, 2.4))
at(marks['CALL'] + 2.6, lambda o: (dingdong(o), fanfare(o + 0.6)))
for k, v in marks.items():
    if k.startswith('EV:'): at(v, whoosh)
for k in ['INTRO', 'LINEUP', 'GUESS', 'ZOOM']: at(marks[k] + 0.1, whoosh)
at(marks['END'] + 0.3, fanfare)
at(marks['END'] + 15, whoosh)
fade = int(1.5 * SR); mix[:fade] *= np.linspace(0, 1, fade)
end = int(total * SR); mix[end - 2 * fade:end] *= np.linspace(1, 0, 2 * fade)
mix = mix[:end]; mix /= max(1e-9, np.abs(mix).max()) / 0.8
with wave.open(out, 'wb') as w:
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes((mix * 32767).astype(np.int16).tobytes())
print("audio", round(total, 2))
