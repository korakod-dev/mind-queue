"""Compose how-to-play.mp4 (template + big screen + phone per segment) and extract the projector
frames (.work/scr) that render-classroom.mjs draws onto the classroom's screen."""
import json, os, shutil, subprocess

WORK = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".work")
os.chdir(WORK)
segs = json.load(open("segments.json"))
with open("htp_list.txt", "w") as lst:
    for i, s in enumerate(segs):
        d = (s["e"] - s["s"]) / s["v"]
        f = (f"[1:v]trim={s['s']}:{s['e']},setpts=(PTS-STARTPTS)/{s['v']},scale=1232:693:flags=lanczos[h];"
             f"[2:v]trim={s['s']}:{s['e']},setpts=(PTS-STARTPTS)/{s['v']},scale=334:723:flags=lanczos[p];"
             f"[0:v][h]overlay=44:84[a];[a][p]overlay=1444:80,fps=30,format=yuv420p[o]")
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-loop", "1", "-t", f"{d:.3f}", "-i", f"tpl{i}.png", "-i", "host.mp4", "-i", "phone.mp4",
                        "-filter_complex", f, "-map", "[o]", "-t", f"{d:.3f}", "-c:v", "libx264", "-crf", "18", "-preset", "medium", f"seg{i}.mp4"], check=True)
        lst.write(f"file 'seg{i}.mp4'\n")
subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", "htp_list.txt", "-i", "soundtrack.wav",
                "-c:v", "copy", "-c:a", "aac", "-b:a", "160k", "-shortest", "-movflags", "+faststart", "how-to-play.mp4"], check=True)
parts, maps = [], []
for i, s in enumerate(segs):
    parts.append(f"[0:v]trim={s['s']}:{s['e']},setpts=(PTS-STARTPTS)/{s['v']},fps=24,scale=800:450:flags=lanczos[v{i}]"); maps.append(f"[v{i}]")
shutil.rmtree("scr", ignore_errors=True); os.makedirs("scr")
subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", "host.mp4", "-filter_complex", ";".join(parts) + ";" + "".join(maps) + f"concat=n={len(segs)}:v=1:a=0[o]",
                "-map", "[o]", "-q:v", "3", "scr/%06d.jpg"], check=True)
print("how-to-play ok · projector frames", len(os.listdir("scr")))
