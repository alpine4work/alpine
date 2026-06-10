#!/usr/bin/env python3

from __future__ import annotations

import json
import mimetypes
import statistics
import subprocess
from pathlib import Path

from imjoshin_tags_render_results_markdown import MEDIA_DESCRIPTIONS


MODEL_SPEC = {
    "label": "Bedrock Gemma 3 12B IT + Whisper-base.en",
    "language": "TypeScript + Amazon Bedrock",
    "notes": "Gemma 3 12B IT on Amazon Bedrock for image/video understanding and transcript summarization; local Whisper base in TypeScript for transcription.",
    "strengths": [
        "Closest experiment here to a managed multimodal model path that still avoids per-file hosted LLM calls to larger premium models.",
        "Provides token usage and direct Bedrock cost estimates, which lets us reason about operational cost much more concretely than the local-only probes.",
        "Supports image input directly, so we can test whether a single hosted multimodal model can cover both tags and summary generation for images and videos.",
    ],
    "offload": [
        "Image and video frame understanding are offloaded to Gemma 3 12B IT on Amazon Bedrock because it supports text and image input through the Bedrock Converse API.",
        "Audio and video speech transcription are still handled locally by Whisper base in TypeScript because this experiment is about using Gemma to analyze transcripts, not about replacing speech-to-text.",
        "Video frame sampling is handled locally so we can control how many images we send to Bedrock and tie the cost estimate to a clear frame-count heuristic.",
    ],
}


def main() -> None:
    directory_path = Path(__file__).resolve().parent
    test_files_directory_path = directory_path / "test-files"
    results_path = directory_path / "results-gemma.md"

    media_file_paths = sorted(
        path
        for path in test_files_directory_path.iterdir()
        if path.is_file()
        and path.name != ".DS_Store"
        and ".json" not in path.suffixes
    )

    result_data_by_file_name: dict[str, dict] = {}
    for media_file_path in media_file_paths:
        output_path = test_files_directory_path / f"{media_file_path.stem}.gemma.json"
        if not output_path.exists():
            continue
        try:
            result_data_by_file_name[media_file_path.name] = json.loads(output_path.read_text())
        except json.JSONDecodeError:
            continue

    lines: list[str] = []
    lines.append("# Media Tagging Bake-Off: Bedrock Gemma")
    lines.append("")
    lines.append("## Overview")
    lines.append("")
    lines.append(
        "This report is the Bedrock-hosted Gemma 3 sibling to the local-only media tagging bake-off."
    )
    lines.append(
        "The goal is to measure what we can get from a relatively cheap managed multimodal model while still staying far below the cost profile of defaulting every file to a larger premium hosted LLM."
    )
    lines.append("")
    lines.append("## Goals")
    lines.append("")
    lines.append(
        "- Understand Bedrock Gemma 3 quality on the same corpus we used for local model testing."
    )
    lines.append(
        "- Capture input and output token usage per file so cost is measurable instead of hypothetical."
    )
    lines.append(
        "- Estimate cost per image, per video, and per audio summary using a clear frame-sampling policy."
    )
    lines.append(
        "- Compare a managed multimodal path against the Florence local baseline without changing the test corpus."
    )
    lines.append("")
    lines.append("## Non-goals")
    lines.append("")
    lines.append(
        "- This is not a full Bedrock bake-off across every hosted model family."
    )
    lines.append(
        "- This is not a production integration yet; it is an experiment focused on quality and token cost."
    )
    lines.append(
        "- This does not replace the local model investigation. It complements it."
    )
    lines.append("")
    lines.append("## Integration")
    lines.append("")
    lines.append(
        "The same two integration shapes still apply here: run inline in `processFile` or schedule a follow-up job."
    )
    lines.append(
        "For Bedrock specifically, a follow-up job may be the safer default if we want to control cost, concurrency, retries, and regional rate limits more explicitly."
    )
    lines.append(
        "Inline `processFile` integration is still possible, but it would turn file processing time and Bedrock availability into part of the upload path."
    )
    lines.append("")
    lines.append("## Methodology")
    lines.append("")
    lines.append(
        "- `tags` means a short list of 5 searchable keywords or phrases ordered by importance."
    )
    lines.append(
        "- `summary` means a concise factual sentence that could plausibly inform alt text or agent-facing markdown link text."
    )
    lines.append(
        "- `input tokens` and `output tokens` come directly from the Bedrock Converse API usage field."
    )
    lines.append(
        "- `estimated cost` is computed from Bedrock standard on-demand pricing in `us-east-1` for Gemma 3 12B: `$0.09` per 1M input tokens and `$0.29` per 1M output tokens."
    )
    lines.append(
        "- Images are sent as a single resized JPEG."
    )
    lines.append(
        "- Audio is transcribed locally with Whisper base, then Gemma 3 summarizes and tags the transcript."
    )
    lines.append(
        "- Videos are sampled into multiple chronological frames, then Gemma 3 analyzes the full frame set together plus the transcript when audio exists."
    )
    lines.append(
        "- Video frame counts use this heuristic: one middle frame if duration is under 5 seconds; up to 10 frames by 60 seconds; up to about 20 frames by 3 minutes; capped at 20 frames."
    )
    lines.append("")
    lines.append("## Models")
    lines.append("")
    lines.append(
        "This stack was chosen because it gives us a managed multimodal baseline with direct image support, token accounting, and lower pricing than larger flagship hosted models."
    )
    lines.append("")
    lines.append(f"### {MODEL_SPEC['label']}")
    lines.append("")
    lines.append(f"- language: `{MODEL_SPEC['language']}`")
    lines.append("- output suffix: `.gemma.json`")
    lines.append(f"- notes: {MODEL_SPEC['notes']}")
    lines.append("- strengths:")
    for strength in MODEL_SPEC["strengths"]:
        lines.append(f"  - {strength}")
    lines.append("- work split:")
    for offload_note in MODEL_SPEC["offload"]:
        lines.append(f"  - {offload_note}")
    lines.append("")
    lines.append("## Cost Summary")
    lines.append("")
    lines.extend(render_cost_summary(result_data_by_file_name, media_file_paths))
    lines.append("")
    lines.append("## Results")
    lines.append("")

    for media_file_path in media_file_paths:
        lines.append(f"### {media_file_path.name}")
        lines.append("")
        lines.append(
            f"Description: {MEDIA_DESCRIPTIONS.get(media_file_path.name, 'Description missing.')}"
        )
        lines.append("")
        lines.append(
            "File Metadata: "
            + f"File Size: {format_file_size(media_file_path.stat().st_size)}, "
            + f"Duration: {get_media_duration_display(media_file_path)}, "
            + f"Content Type: `{get_media_content_type(media_file_path)}`"
        )
        lines.append("")

        data = result_data_by_file_name.get(media_file_path.name)
        lines.append(f"*{MODEL_SPEC['label']}*")

        if data is None:
            lines.append("- duration: `MISSING`")
            lines.append("- max mem. usage: `MISSING`")
            lines.append("- input tokens: `MISSING`")
            lines.append("- output tokens: `MISSING`")
            lines.append("- estimated cost: `MISSING`")
            lines.append("- tags: `MISSING`")
            lines.append("- summary: `MISSING`")
            lines.append("")
            continue

        lines.append(
            f"- duration: `{format_elapsed_duration(data.get('totalDurationMs'))}`"
        )
        lines.append(
            f"- max mem. usage: `{format_memory_usage(data.get('peakRssMiB'))}`"
        )
        token_usage = data.get("tokenUsage", {})
        lines.append(f"- input tokens: `{render_int(token_usage.get('inputTokens'))}`")
        lines.append(f"- output tokens: `{render_int(token_usage.get('outputTokens'))}`")
        lines.append(
            f"- estimated cost: `{format_cost_usd(data.get('estimatedCostUsd'))}`"
        )
        frame_sampling = data.get("frameSampling", {})
        if isinstance(frame_sampling, dict) and frame_sampling.get("frameCount"):
            lines.append(
                f"- frame sampling: `count={frame_sampling.get('frameCount')}, timestamps={json.dumps(frame_sampling.get('frameTimestampsSeconds', []))}`"
            )
        lines.append(f"- tags: {render_value(data.get('final', {}).get('tags'))}")
        lines.append(f"- summary: {render_value(data.get('final', {}).get('summary'))}")
        lines.append("")

    results_path.write_text("\n".join(lines).rstrip() + "\n")


def render_cost_summary(
    result_data_by_file_name: dict[str, dict],
    media_file_paths: list[Path],
) -> list[str]:
    lines: list[str] = []
    rows_by_route = {"Image": [], "Audio": [], "Video": []}

    for media_file_path in media_file_paths:
        data = result_data_by_file_name.get(media_file_path.name)
        if data is None:
            continue
        route = data.get("route")
        if route not in rows_by_route:
            continue
        rows_by_route[route].append(data)

    for route in ["Image", "Video", "Audio"]:
        rows = rows_by_route[route]
        lines.append(f"### {route}")
        lines.append("")
        if not rows:
            lines.append("- No results yet.")
            lines.append("")
            continue

        input_tokens = [int(row.get("tokenUsage", {}).get("inputTokens", 0)) for row in rows]
        output_tokens = [int(row.get("tokenUsage", {}).get("outputTokens", 0)) for row in rows]
        costs = [float(row.get("estimatedCostUsd", 0)) for row in rows]
        lines.append(f"- files: `{len(rows)}`")
        lines.append(f"- avg input tokens: `{round(statistics.mean(input_tokens))}`")
        lines.append(f"- avg output tokens: `{round(statistics.mean(output_tokens))}`")
        lines.append(f"- avg estimated cost: `{format_cost_usd(statistics.mean(costs))}`")
        lines.append(f"- median estimated cost: `{format_cost_usd(statistics.median(costs))}`")
        lines.append(f"- max estimated cost: `{format_cost_usd(max(costs))}`")

        if route == "Video":
            frame_counts = [
                int(row.get("frameSampling", {}).get("frameCount", 0))
                for row in rows
            ]
            durations_minutes = [
                get_result_duration_minutes(row, media_file_paths)
                for row in rows
            ]
            cost_per_minute = [
                cost / duration_minutes
                for cost, duration_minutes in zip(costs, durations_minutes)
                if duration_minutes > 0
            ]
            lines.append(f"- avg frames per video: `{round(statistics.mean(frame_counts), 1)}`")
            if cost_per_minute:
                lines.append(
                    f"- avg cost per minute of video: `{format_cost_usd(statistics.mean(cost_per_minute))}`"
                )

        if route == "Audio":
            durations_minutes = [
                get_result_duration_minutes(row, media_file_paths)
                for row in rows
            ]
            cost_per_minute = [
                cost / duration_minutes
                for cost, duration_minutes in zip(costs, durations_minutes)
                if duration_minutes > 0
            ]
            if cost_per_minute:
                lines.append(
                    f"- avg cost per minute of audio: `{format_cost_usd(statistics.mean(cost_per_minute))}`"
                )
        lines.append("")

    return lines


def get_result_duration_minutes(result: dict, media_file_paths: list[Path]) -> float:
    file_path = Path(result.get("filePath", ""))
    if not file_path.exists():
        for media_file_path in media_file_paths:
            if media_file_path.name == file_path.name:
                file_path = media_file_path
                break
    content_type = get_media_content_type(file_path)
    if not (content_type.startswith("audio/") or content_type.startswith("video/")):
        return 0
    ffprobe_path = find_ffprobe_path()
    if ffprobe_path is None:
        return 0
    try:
        duration_output = subprocess.check_output(
            [
                ffprobe_path,
                "-v",
                "error",
                "-show_entries",
                "format=duration",
                "-of",
                "default=noprint_wrappers=1:nokey=1",
                str(file_path),
            ],
            text=True,
        ).strip()
        return float(duration_output) / 60
    except (OSError, subprocess.CalledProcessError, ValueError):
        return 0


def render_value(value: object) -> str:
    if value is None:
        return "`null`"
    return f"`{json.dumps(value, ensure_ascii=False)}`"


def render_int(value: object) -> str:
    if not isinstance(value, int | float):
        return "n/a"
    return f"{int(value)}"


def format_cost_usd(value: object) -> str:
    if not isinstance(value, int | float):
        return "n/a"
    if value == 0:
        return "$0.000000"
    return f"${value:.6f}"


def format_file_size(size_bytes: int) -> str:
    size_mib = size_bytes / (1024 * 1024)
    if size_mib >= 100:
        return f"{round(size_mib):.0f} MiB"
    if size_mib >= 10:
        return f"{size_mib:.1f} MiB"
    return f"{size_mib:.2f} MiB"


def format_elapsed_duration(duration_ms: object) -> str:
    if not isinstance(duration_ms, int | float):
        return "n/a"
    total_seconds = max(int(round(duration_ms / 1000)), 0)
    minutes, seconds = divmod(total_seconds, 60)
    hours, minutes = divmod(minutes, 60)
    if hours > 0:
        return f"{hours}h{minutes:02d}m{seconds:02d}s"
    return f"{minutes}m{seconds:02d}s"


def format_memory_usage(peak_rss_mib: object) -> str:
    if not isinstance(peak_rss_mib, int | float):
        return "n/a"
    if peak_rss_mib >= 1024:
        return f"{peak_rss_mib / 1024:.2f} GiB"
    if peak_rss_mib >= 100:
        return f"{round(peak_rss_mib):.0f} MiB"
    return f"{peak_rss_mib:.1f} MiB"


def get_media_content_type(media_file_path: Path) -> str:
    guessed_content_type, _encoding = mimetypes.guess_type(media_file_path.name)
    return guessed_content_type or "application/octet-stream"


def get_media_duration_display(media_file_path: Path) -> str:
    guessed_content_type = get_media_content_type(media_file_path)
    if not (
        guessed_content_type.startswith("audio/") or guessed_content_type.startswith("video/")
    ):
        return "n/a"

    ffprobe_path = find_ffprobe_path()
    if ffprobe_path is None:
        return "n/a"

    try:
        duration_output = subprocess.check_output(
            [
                ffprobe_path,
                "-v",
                "error",
                "-show_entries",
                "format=duration",
                "-of",
                "default=noprint_wrappers=1:nokey=1",
                str(media_file_path),
            ],
            text=True,
        ).strip()
        duration_seconds = float(duration_output)
    except (OSError, subprocess.CalledProcessError, ValueError):
        return "n/a"

    return format_elapsed_duration(duration_seconds * 1000)


def find_ffprobe_path() -> str | None:
    repository_root_directory_path = Path(__file__).resolve().parents[4]
    try:
        bazel_bin_directory_path = subprocess.check_output(
            ["bazel", "info", "bazel-bin"],
            cwd=repository_root_directory_path,
            text=True,
        ).strip()
    except (OSError, subprocess.CalledProcessError):
        return None

    ffprobe_path = (
        Path(bazel_bin_directory_path)
        / "admin/experimental/imjoshin/media-tagging/file_content_probe.sh.runfiles/ffmpeg/install/bin/ffprobe"
    )
    if ffprobe_path.exists():
        return str(ffprobe_path)
    return None


if __name__ == "__main__":
    main()
