"""Generate the placeholder assets the site ships with until the real ones exist:
animation video, sample mask, placeholder song with timed lyrics, and a thumbnail.

Existing files are never overwritten (pass --force to replace them), so this cannot
wipe real assets that were dropped into assets/.

Usage: python tools/make-placeholders.py <source.png> [--force]
"""
import math, os, subprocess, sys, wave
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

src = sys.argv[1]
force = "--force" in sys.argv
assets = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "assets")
os.makedirs(assets, exist_ok=True)

def taken(name):
    path = os.path.join(assets, name)
    if os.path.exists(path) and not force:
        print("kept   ", name)
        return path, True
    return path, False

# --- animation: a slow "breathing" zoom. It starts and ends at zoom 1, so the loop has
# no seam, and frame 0 is the print itself, which is what the overlay needs. -------------
W, H, FPS, SECONDS, ZOOM = 816, 1088, 30, 8, 0.025
N = FPS * SECONDS
path, skip = taken("animation.mp4")
if not skip:
    base = Image.open(src).convert("RGB")
    sx, sy = base.width / W, base.height / H
    def frame(n):
        z = 1 + ZOOM * (1 - math.cos(2 * math.pi * n / N)) / 2
        ax, ay = sx / z, sy / z
        return base.transform((W, H), Image.Transform.AFFINE,
                              (ax, 0, base.width / 2 - W / 2 * ax, 0, ay, base.height / 2 - H / 2 * ay),
                              resample=Image.BICUBIC)
    # Written under a temporary name so a failed run never leaves a half file behind.
    partial = path + ".part"
    proc = subprocess.Popen([
        "ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
        "-vf", "scale=out_color_matrix=bt709:out_range=tv,format=yuv420p",
        "-c:v", "libx264", "-profile:v", "high", "-crf", "25", "-preset", "slow",
        "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv",
        "-movflags", "+faststart", "-an", "-f", "mp4", partial], stdin=subprocess.PIPE)
    try:
        for n in range(N):
            proc.stdin.write(frame(n).tobytes())
        proc.stdin.close()
        ok = proc.wait() == 0
    except BaseException:
        proc.kill()
        ok = False
    if not ok:
        if os.path.exists(partial):
            os.remove(partial)
        sys.exit("ffmpeg failed to encode the animation")
    os.replace(partial, path)
    print("written", "animation.mp4")

# --- sample mask: white shows the video, black leaves the real print visible -------------
path, skip = taken("animation-mask.sample.png")
if not skip:
    mask = Image.new("L", (W, H), 0)
    ImageDraw.Draw(mask).ellipse((int(W * 0.22), int(H * 0.12), int(W * 0.78), int(H * 0.70)), fill=255)
    mask.filter(ImageFilter.GaussianBlur(45)).save(path)
    print("written", "animation-mask.sample.png")

# --- placeholder song: a music-box melody over eight bars, in G major pentatonic ---------
SR, BPM = 44100, 80
beat = 60 / BPM
NOTE = {"C3": 130.81, "D3": 146.83, "E3": 164.81, "G3": 196.00,
        "G4": 392.00, "A4": 440.00, "B4": 493.88, "D5": 587.33, "E5": 659.25}
melody = [  # (note, beats) per bar, 3/4 time
    [("B4", 1), ("D5", 1), ("E5", 1)],
    [("D5", 2), ("B4", 1)],
    [("A4", 1), ("B4", 1), ("D5", 1)],
    [("B4", 3)],
    [("E5", 1), ("D5", 1), ("B4", 1)],
    [("A4", 2), ("G4", 1)],
    [("A4", 1), ("B4", 1), ("A4", 1)],
    [("G4", 3)],
]
bass = ["G3", "E3", "D3", "D3", "C3", "G3", "D3", "G3"]
lyrics = [
    "Esta linha é só um exemplo de letra,",
    "a música de verdade entra no lugar dela.",
    "Cada palavra acende na hora certa,",
    "como num karaokê.",
    "É só trocar o arquivo lyrics.lrc",
    "pela letra da música,",
    "com a marcação de tempo",
    "de cada linha.",
]

path_music, skip_music = taken("music.mp3")
path_lyrics, skip_lyrics = taken("lyrics.lrc")
if not (skip_music and skip_lyrics):
    bar = 3 * beat
    total = len(melody) * bar + 2.0
    audio = np.zeros(int(total * SR))

    def pluck(freq, start, length):
        t = np.arange(int((length + 0.6) * SR)) / SR
        env = (np.exp(-t / 0.9) + 0.30 * np.exp(-t / 0.35)) * np.minimum(t / 0.008, 1)
        wave_ = np.sin(2 * np.pi * freq * t) + 0.35 * np.sin(4 * np.pi * freq * t) * np.exp(-t / 0.3) \
            + 0.12 * np.sin(6 * np.pi * freq * t) * np.exp(-t / 0.15)
        i = int(start * SR)
        audio[i:i + len(t)] += env * wave_ * np.linspace(1, 0, len(t)) ** 4

    for i, notes in enumerate(melody):
        at = i * bar
        t = np.arange(int(2.5 * SR)) / SR
        pad = np.sin(2 * np.pi * NOTE[bass[i]] * t) * np.exp(-t / 1.2) * np.minimum(t / 0.05, 1) * 0.22
        audio[int(at * SR):int(at * SR) + len(t)] += pad
        for name, beats in notes:
            pluck(NOTE[name], at, beats * beat)
            at += beats * beat

    audio *= 0.7 / np.abs(audio).max()
    fade = np.minimum((total - np.arange(len(audio)) / SR) / 1.5, 1).clip(0, 1)
    audio *= fade

    if not skip_music:
        wav = path_music + ".wav"
        with wave.open(wav, "wb") as f:
            f.setnchannels(1)
            f.setsampwidth(2)
            f.setframerate(SR)
            f.writeframes((audio * 32767).astype("<i2").tobytes())
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", wav, "-c:a", "libmp3lame", "-q:a", "2", path_music], check=True)
        os.remove(wav)
        print("written", "music.mp3")

    # Enhanced LRC: one timestamp per line, then one per word. Words are spread evenly
    # over their bar, which is close enough for the melody above.
    if not skip_lyrics:
        def stamp(s):
            return "[%02d:%05.2f]" % (int(s // 60), s % 60)
        lines = []
        for i, text in enumerate(lyrics):
            words = text.split()
            step = bar / len(words)
            lines.append(stamp(i * bar) + "".join(stamp(i * bar + k * step) + w + " " for k, w in enumerate(words)).rstrip())
        with open(path_lyrics, "w", encoding="utf-8", newline="\n") as f:
            f.write("[ti:Letra de exemplo]\n[re:quadro-ar]\n" + "\n".join(lines) + "\n")
        print("written", "lyrics.lrc")

# --- thumbnail shown on the start screen ---------------------------------------------
path, skip = taken("thumb.jpg")
if not skip:
    Image.open(src).convert("RGB").resize((270, 360), Image.LANCZOS).save(path, quality=82)
    print("written", "thumb.jpg")
