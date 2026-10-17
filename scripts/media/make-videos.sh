#!/usr/bin/env bash
# Rebuild media/how-to-play.mp4, media/classroom-atmosphere.mp4 and media/online-atmosphere.mp4
# from a live local game (needs `npm run dev` running; takes ~15 min). ⚠ Resets the room.
set -euo pipefail
cd "$(dirname "$0")"
node reset.mjs
node record.mjs                    # live game with 52 bots + 1 phone, screencast both screens
python3 build-clips.py             # exact-timed clips + segment plan + captions
node templates.mjs                 # caption/frame template per segment
python3 soundtrack.py              # procedural music + SFX synced to the game
python3 compose.py                 # how-to-play.mp4 + projector frames
node render-classroom.mjs          # illustrated classroom, frame by frame
ffmpeg -v error -y -framerate 24 -i .work/cls/%06d.jpg -i .work/soundtrack.wav -c:v libx264 -crf 20 -preset medium \
  -pix_fmt yuv420p -c:a aac -b:a 160k -shortest -movflags +faststart .work/classroom-atmosphere.mp4
node render-online.mjs             # online class: shared screen + everyone at home
ffmpeg -v error -y -framerate 24 -i .work/online/%06d.jpg -i .work/soundtrack.wav -c:v libx264 -crf 20 -preset medium \
  -pix_fmt yuv420p -c:a aac -b:a 160k -shortest -movflags +faststart .work/online-atmosphere.mp4
cp .work/how-to-play.mp4 .work/classroom-atmosphere.mp4 .work/online-atmosphere.mp4 ../../media/
echo "videos updated in media/"
