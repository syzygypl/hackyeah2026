# Demo video script (MP4, max 3:00)

Required for HubMI and Cracow (in Polish). For other tasks, record it anyway as a backup for the live demo. Target 2:45 so we never go over 3:00.

## Script

| Time | On screen | Voice-over (fill in) |
|---|---|---|
| 0:00-0:10 | Title card: project name, one-line promise, team name | "`[Project]` helps `[user]` `[do X]`." |
| 0:10-0:30 | Problem: photo or stat, then the user's situation today | "`[User]` today has to `[pain]`. That costs `[time/money/risk]`." |
| 0:30-0:45 | Solution: hero screen of the app | "We built `[one sentence]`." |
| 0:45-1:45 | **Live demo, steps 1-3** of the demo script, real app on the deployed URL, cursor visible | Narrate what the user does and why it matters, not the buttons. One sentence per step |
| 1:45-2:10 | **Wow moment** | "`[what makes judges remember us]`" |
| 2:10-2:25 | Value number, big on screen | "`[value number]`, measured by `[how]`." |
| 2:25-2:40 | How it works: architecture slide, then criteria coverage (e.g. WCAG checks, test suite run) | "Under the hood: `[stack, the real part]`. `[criterion-specific proof]`." |
| 2:40-2:50 | Closing card: name, demo URL, repo URL, team | "`[Project]`. Try it at `[URL]`." |

Rules of thumb: show, don't tell; no login screens or loading spinners (cut them); real, story-like data, no lorem ipsum; the narration language must match the task (PL for HubMI/Cracow).

## Recording tips

- **Prepare:** browser in a clean profile, 1920x1080 window, zoom 110-125% so text is readable, notifications off (macOS Focus mode), bookmarks bar hidden, demo data seeded, every step rehearsed once.
- **Screen:** QuickTime Player > File > New Screen Recording (Cmd+Shift+5, "Record Selected Portion", Options > microphone). Or OBS: Canvas and Output 1920x1080, 30 fps, Recording format mp4 (or mkv then Remux to mp4).
- **Audio:** record voice-over separately in a quiet spot (stairwell, car) with a phone or headset mic, then lay it over the screen recording. Venue noise ruins live narration.
- **Edit:** iMovie or DaVinci Resolve, or `ffmpeg` to trim. Cut waits, speed up slow parts, add title and closing cards.
- **Export:** MP4, H.264, 1080p, AAC audio. Check it's at most 3:00:
  ```sh
  ffprobe -v error -show_entries format=duration -of csv=p=0 demo.mp4
  # if too big for upload:
  ffmpeg -i demo.mp4 -vcodec libx264 -crf 26 -preset fast -acodec aac -b:a 128k demo-small.mp4
  ```
- **Check:** watch it once fully with sound on another device before uploading. Keep a copy in the shared folder.
