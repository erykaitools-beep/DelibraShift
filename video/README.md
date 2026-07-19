# DelibraShift competition video

This directory contains the reproducible renderer for the project-first Build
Week video. It reads the six English narration blocks directly from
`VIDEO_SCRIPT.md`; the spoken script therefore has one source of truth.

The renderer:

1. builds the canonical offline report;
2. synthesizes one narration track per scene;
3. records the real report in Chromium and renders local evidence cards;
4. derives subtitle timing from the speech synthesis output;
5. assembles, captions, and validates a 1080p H.264/AAC MP4.

Run from the repository root:

```bash
python -m pip install -r video/requirements.txt
npm --prefix report ci
npm --prefix report exec playwright install chromium
python video/build_video.py
```

On a minimal Linux host, Chromium may also need its distribution libraries:

```bash
sudo npm --prefix report exec playwright install-deps chromium
```

That system step is unnecessary when a compatible desktop Chromium runtime is
already available. The checked-in renderer also detects a repository-local
`video/build/sysroot` for restricted containers where global installation is
not possible.

Generated intermediates are written to `video/build/`. Final deliverables are
written to `video/output/`; both directories are intentionally ignored by Git.
The narration is synthetic and should be disclosed as such when the video is
published.
