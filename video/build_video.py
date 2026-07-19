from __future__ import annotations

import hashlib
import json
import os
import re
import subprocess
import sys
from pathlib import Path

import imageio_ffmpeg


ROOT = Path(__file__).resolve().parents[1]
BUILD = ROOT / "video" / "build"
OUTPUT = ROOT / "video" / "output"
SCRIPT = ROOT / "VIDEO_SCRIPT.md"
FFMPEG = Path(imageio_ffmpeg.get_ffmpeg_exe())
EDGE_TTS = Path(sys.executable).with_name("edge-tts" + (".exe" if os.name == "nt" else ""))
VOICE = "en-US-AndrewNeural"
RATE = "-8%"
SCENE_IDS = ["what", "lab", "results", "evidence", "codex", "close"]


def run(*args: str | Path) -> None:
    command = [str(arg) for arg in args]
    print("+", " ".join(command))
    subprocess.run(command, cwd=ROOT, check=True)


def narration_blocks() -> list[str]:
    text = SCRIPT.read_text(encoding="utf-8")
    parts = re.split(r"(?=^### \d+:\d+)", text, flags=re.MULTILINE)
    blocks: list[str] = []
    for part in parts:
        if not re.match(r"^### \d+:\d+", part):
            continue
        quoted = []
        for line in part.splitlines():
            if line.startswith(">"):
                quoted.append(line[1:].strip())
            elif quoted:
                break
        if quoted:
            blocks.append(" ".join(quoted))
    if len(blocks) != len(SCENE_IDS):
        raise RuntimeError(f"expected {len(SCENE_IDS)} narration blocks, found {len(blocks)}")
    return blocks


def duration(path: Path) -> float:
    result = subprocess.run(
        [str(FFMPEG), "-hide_banner", "-i", str(path), "-f", "null", "-"],
        cwd=ROOT,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
        text=True,
        check=False,
    )
    match = re.search(r"Duration: (\d+):(\d+):(\d+(?:\.\d+)?)", result.stderr)
    if not match:
        raise RuntimeError(f"could not read duration of {path}")
    hours, minutes, seconds = match.groups()
    return int(hours) * 3600 + int(minutes) * 60 + float(seconds)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def parse_timestamp(value: str) -> float:
    hours, minutes, rest = value.replace(".", ",").split(":")
    seconds, millis = rest.split(",")
    return int(hours) * 3600 + int(minutes) * 60 + int(seconds) + int(millis) / 1000


def format_timestamp(value: float) -> str:
    millis_total = max(0, round(value * 1000))
    hours, remainder = divmod(millis_total, 3_600_000)
    minutes, remainder = divmod(remainder, 60_000)
    seconds, millis = divmod(remainder, 1000)
    return f"{hours:02d}:{minutes:02d}:{seconds:02d},{millis:03d}"


def shifted_subtitles(scene_meta: list[dict[str, object]], destination: Path) -> None:
    cues: list[tuple[float, float, str]] = []
    offset = 0.0
    cue_re = re.compile(
        r"\d+\s*\n(\d\d:\d\d:\d\d[,.]\d{3}) --> (\d\d:\d\d:\d\d[,.]\d{3})\s*\n(.+?)(?=\n\s*\n|\Z)",
        re.DOTALL,
    )
    for meta in scene_meta:
        subtitle_path = Path(str(meta["subtitle_path"]))
        for match in cue_re.finditer(subtitle_path.read_text(encoding="utf-8")):
            start = offset + 0.5 + parse_timestamp(match.group(1))
            end = offset + 0.5 + parse_timestamp(match.group(2))
            cues.append((start, end, " ".join(match.group(3).splitlines())))
        offset += float(meta["scene_duration"])
    lines = []
    for number, (start, end, text) in enumerate(cues, 1):
        lines.extend([str(number), f"{format_timestamp(start)} --> {format_timestamp(end)}", text, ""])
    destination.write_text("\n".join(lines), encoding="utf-8", newline="\n")


def main() -> None:
    BUILD.mkdir(parents=True, exist_ok=True)
    OUTPUT.mkdir(parents=True, exist_ok=True)
    run(Path(sys.executable), ROOT / "report" / "build_report.py", "--lang", "en")

    blocks = narration_blocks()
    metadata: list[dict[str, object]] = []
    for index, (scene_id, text) in enumerate(zip(SCENE_IDS, blocks), 1):
        stem = f"{index:02d}_{scene_id}"
        audio = BUILD / f"{stem}.mp3"
        subtitles = BUILD / f"{stem}.srt"
        raw_video = BUILD / f"{stem}.webm"
        scene_video = BUILD / f"{stem}.mp4"

        run(
            EDGE_TTS,
            "--voice", VOICE,
            f"--rate={RATE}",
            "--text", text,
            "--write-media", audio,
            "--write-subtitles", subtitles,
        )
        audio_duration = duration(audio)
        scene_duration = audio_duration + 1.2
        run(
            "node", ROOT / "video" / "render_capture.mjs",
            f"--scene={scene_id}",
            f"--duration-ms={round(scene_duration * 1000)}",
            f"--output={raw_video}",
        )
        fade_out = max(0.3, scene_duration - 0.3)
        run(
            FFMPEG, "-y", "-hide_banner", "-loglevel", "warning",
            "-i", raw_video, "-i", audio,
            "-filter_complex",
            (
                f"[0:v]scale=1920:1080:force_original_aspect_ratio=decrease,"
                f"pad=1920:1080:(ow-iw)/2:(oh-ih)/2,"
                f"fade=t=in:st=0:d=0.3,fade=t=out:st={fade_out:.3f}:d=0.3[v];"
                f"[1:a]adelay=500,apad,afade=t=in:st=0:d=0.2,"
                f"afade=t=out:st={fade_out:.3f}:d=0.3[a]"
            ),
            "-map", "[v]", "-map", "[a]", "-t", f"{scene_duration:.3f}",
            "-r", "30", "-c:v", "libx264", "-preset", "medium", "-crf", "19",
            "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", scene_video,
        )
        metadata.append({
            "id": scene_id,
            "text": text,
            "audio_duration": audio_duration,
            "scene_duration": scene_duration,
            "audio_path": str(audio),
            "subtitle_path": str(subtitles),
            "video_path": str(scene_video),
        })

    subtitle_output = OUTPUT / "delibrashift_build_week.srt"
    shifted_subtitles(metadata, subtitle_output)
    final_video = OUTPUT / "delibrashift_build_week.mp4"
    subtitle_filter = (
        f"subtitles=filename='{subtitle_output.as_posix()}':"
        "force_style='FontName=DejaVu Sans,FontSize=16,PrimaryColour=&H00FFFFFF,"
        "OutlineColour=&HCC000000,BackColour=&H92000000,BorderStyle=3,"
        "Outline=1,Shadow=0,MarginV=30,Alignment=2'"
    )
    input_args: list[str | Path] = []
    filter_parts: list[str] = []
    video_concat_inputs = []
    for index, item in enumerate(metadata):
        input_args.extend(["-i", Path(str(item["video_path"]))])
        filter_parts.append(f"[{index}:v]setpts=PTS-STARTPTS[v{index}]")
        video_concat_inputs.append(f"[v{index}]")
    filter_parts.append(
        "".join(video_concat_inputs) + f"concat=n={len(metadata)}:v=1:a=0[vcat]"
    )
    audio_concat_inputs = []
    for index, item in enumerate(metadata):
        input_index = len(metadata) + index
        input_args.extend(["-i", Path(str(item["audio_path"]))])
        scene_duration = float(item["scene_duration"])
        filter_parts.append(
            f"[{input_index}:a]adelay=500,apad,atrim=duration={scene_duration:.3f},"
            f"asetpts=PTS-STARTPTS[a{index}]"
        )
        audio_concat_inputs.append(f"[a{index}]")
    filter_parts.append(
        "".join(audio_concat_inputs) + f"concat=n={len(metadata)}:v=0:a=1[acat]"
    )
    filter_parts.append(f"[vcat]{subtitle_filter}[vout]")
    filter_parts.append("[acat]loudnorm=I=-16:LRA=11:TP=-1.5[aout]")
    run(
        FFMPEG, "-y", "-hide_banner", "-loglevel", "warning",
        *input_args,
        "-filter_complex", ";".join(filter_parts),
        "-map", "[vout]", "-map", "[aout]",
        "-r", "30", "-c:v", "libx264", "-preset", "medium", "-crf", "18",
        "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k", "-ar", "48000", "-ac", "2",
        "-movflags", "+faststart", final_video,
    )

    total_duration = duration(final_video)
    if total_duration >= 180:
        raise RuntimeError(f"final video exceeds three minutes: {total_duration:.2f}s")
    summary = {
        "video": str(final_video),
        "video_sha256": sha256(final_video),
        "video_size_bytes": final_video.stat().st_size,
        "subtitles": str(subtitle_output),
        "subtitles_sha256": sha256(subtitle_output),
        "duration_seconds": total_duration,
        "resolution": "1920x1080",
        "voice": VOICE,
        "speech_rate": RATE,
        "scenes": metadata,
    }
    (OUTPUT / "build_summary.json").write_text(
        json.dumps(summary, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
        newline="\n",
    )
    print(json.dumps(summary, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
