#!/usr/bin/env python3

from __future__ import annotations

import json
import mimetypes
import subprocess
from pathlib import Path


MODEL_SPECS = [
    {
        "label": "Xenova JS Baseline",
        "language": "TypeScript / Node.js",
        "output_suffix": ".json",
        "notes": "Xenova TrOCR + ViT caption/classifier + Whisper tiny",
        "strengths": [
            "Best reference for a JS/TS-native local stack that stays close to the rest of the codebase.",
            "Fastest stack to iterate on when we want to test routing, memory, and batching behavior from Node.js.",
            "Useful baseline for understanding how far a lightweight local stack can go before quality falls off.",
        ],
        "offload": [
            "OCR is handled by TrOCR because it is lightweight and easy to run from Transformers.js.",
            "Image understanding is handled by ViT captioning and classification because the goal is a simple local visual baseline without a Python runtime.",
            "Speech recognition is handled by Whisper tiny because it is small enough to keep the JS path practical, even though transcript quality is weaker.",
        ],
    },
    {
        "label": "Florence-2-base-ft + RapidOCR + Whisper-base.en",
        "language": "Python",
        "output_suffix": ".florence.json",
        "notes": "Best current Python probe baseline",
        "strengths": [
            "Best overall quality so far across mixed image, video, and audio cases.",
            "Handles screenshots, UI, scenes, and OCR-heavy frames more reliably than the JS baseline.",
            "Good default comparison point for new files because it balances quality and runtime cost.",
        ],
        "offload": [
            "Vision tagging and frame understanding are handled by Florence-2-base-ft because it is the strongest all-around local image model we have tested in this directory.",
            "OCR is offloaded to RapidOCR because dedicated OCR often recovers short visible text better than relying on Florence alone.",
            "Transcription is offloaded to Whisper base because it produces meaningfully better transcripts than Whisper tiny while staying manageable locally.",
        ],
    },
    {
        "label": "Florence-2-base-ft + Whisper-base.en",
        "language": "Python",
        "output_suffix": ".florence-no-rapidocr.json",
        "notes": "Florence OCR/caption only, no RapidOCR",
        "strengths": [
            "Shows how much Florence can do on its own without a separate OCR helper.",
            "Useful for measuring whether RapidOCR actually improves text-heavy media or just adds complexity.",
            "Simpler stack shape when we want fewer moving parts in the pipeline.",
        ],
        "offload": [
            "Vision tagging, captioning, and OCR-like extraction are all pushed onto Florence-2-base-ft to test a more self-contained vision path.",
            "Transcription is still offloaded to Whisper base because Florence is not our speech model.",
        ],
    },
    {
        "label": "Florence-2-base + RapidOCR + Whisper-base.en",
        "language": "Python",
        "output_suffix": ".florence-base.json",
        "notes": "Non fine-tuned Florence base",
        "strengths": [
            "Useful control for understanding how much the fine-tuning in `base-ft` is helping.",
            "Sometimes produces broader scene descriptions that are helpful for open-ended visual content.",
            "Good comparison point when fine-tuned behavior looks overfit or oddly literal.",
        ],
        "offload": [
            "General vision understanding is handled by Florence-2-base so we can compare base versus fine-tuned Florence directly.",
            "OCR is offloaded to RapidOCR for the same reason as the main Florence stack: better recovery of explicit text when it is present.",
            "Transcription is offloaded to Whisper base to keep the audio side constant while we isolate the vision model difference.",
        ],
    },
    {
        "label": "Florence-2-large-ft + RapidOCR + Whisper-base.en",
        "language": "Python",
        "output_suffix": ".florence-large-ft.json",
        "notes": "Large fine-tuned Florence",
        "strengths": [
            "Best candidate when we want to see whether more vision capacity improves difficult frames.",
            "Often produces richer scene tags than the smaller models on visually dense content.",
            "Useful for checking whether a stronger vision model is worth the extra memory and runtime cost.",
        ],
        "offload": [
            "Vision understanding is offloaded to Florence-2-large-ft to test whether a larger fine-tuned model improves tagging quality on harder media.",
            "OCR is offloaded to RapidOCR because the larger Florence model still benefits from a dedicated text extractor.",
            "Transcription stays on Whisper base so differences are mostly attributable to the vision model size.",
        ],
    },
    {
        "label": "Florence-2-large + RapidOCR + Whisper-base.en",
        "language": "Python",
        "output_suffix": ".florence-large.json",
        "notes": "Large non fine-tuned Florence",
        "strengths": [
            "Measures whether larger raw model capacity helps more than fine-tuning for our media set.",
            "Good sanity check when large-ft and base-ft disagree in surprising ways.",
            "Can surface whether our best results come from model size or task-specific tuning.",
        ],
        "offload": [
            "Vision understanding is offloaded to Florence-2-large so we can separate the effect of model size from the effect of fine-tuning.",
            "OCR remains on RapidOCR because visible text extraction is still a distinct subproblem from general scene understanding.",
            "Transcription remains on Whisper base so the comparison isolates the vision stack.",
        ],
    },
    {
        "label": "Florence-2-base-ft + RapidOCR + Whisper-small.en",
        "language": "Python",
        "output_suffix": ".florence-whisper-small.json",
        "notes": "Same vision stack with a stronger Whisper model",
        "strengths": [
            "Best comparison for asking whether transcript quality is the main bottleneck on audio and video summaries.",
            "Useful when the visual tags are already good but the transcript-driven summary still feels weak.",
            "Helps isolate whether ASR upgrades are more valuable than further vision model changes.",
        ],
        "offload": [
            "Vision tagging stays on Florence-2-base-ft because this variant is meant to keep the visual side fixed.",
            "OCR stays on RapidOCR because text extraction is not the variable being tested here.",
            "Transcription is offloaded to Whisper small to test whether a stronger ASR model materially improves summaries and transcript-derived tags.",
        ],
    },
]

MEDIA_DESCRIPTIONS = {
    "12987324_3840_2160_30fps.mp4": "Video of an aerial view over a road and a construction or village area.",
    "12987350_3840_2160_30fps.mp4": "Video of an aerial view over farm fields, dirt roads, and scattered buildings.",
    "13986302_2160_3840_25fps.mp4": "Video of a blue-gloved hand using a small lab machine or centrifuge.",
    "6567878-uhd_2160_4096_25fps.mp4": "Video of a man presenting while standing against a dark wall and holding objects in his hands.",
    "F33A4268-2.jpg": "Image of a close-up green plant against a blurred background.",
    "IMG_3138.jpg": "Image of a baby sitting on a black blanket in front of a dark backdrop.",
    "IMG_3479.jpg": "Image of a baby sitting in a shopping cart and holding a snack.",
    "IMG_6153.jpg": "Image of an Alpine-stickered laptop and a mug on a wooden table in bright sunlight.",
    "IMG_6164.jpg": "Image of four adults standing on a red dirt trail with red rock mountains behind them.",
    "IMG_7212-2.jpg": "Image of a black-and-white stage portrait of a young musician giving a thumbs up.",
    "PXL_20260214_030737769.mp4": "Video of a colorful video game character standing in a futuristic room.",
    "PXL_20260321_140600157.mp4": "Video of an animal swimming underwater in an aquarium enclosure.",
    "PXL_20260326_132234127~2.mp4": "Video of a sunset over distant mountains and clouds.",
    "PXL_20260425_024503603.mp4": "Video of a band performing on a small dark stage.",
    "Screen Recording 2026-05-15 at 10.15.22 AM.mov": "Screen recording of an Alpine product discussion page with comments and a post about the Design System V2 documentation site.",
    "Screen Recording 2026-05-15 at 10.15.40 AM.mov": "Screen recording of an Alpine product discussion page with comments and design system documentation text.",
    "YTDown_YouTube_Animate-Fish-in-Blender-Lazy-Tutorials_Media_58lc8sLpJzY_002_720p.mp4": "Video of a Blender tutorial showing a fish model and node settings used to animate it swimming.",
    "YTDown_YouTube_Animate-Fish-in-Blender-Lazy-Tutorials_Media_58lc8sLpJzY_007_128k.mp3": "Audio from a Blender tutorial about modeling and animating a swimming fish.",
    "YTDown_YouTube_Nobody-Ever-Buys-Salt_Media_XHsmaxrvsw0_002_720p.mp4": "Video of a salt commercial with a salt canister on a shelf and a person pouring salt.",
    "YTDown_YouTube_Nobody-Ever-Buys-Salt_Media_XHsmaxrvsw0_007_128k.mp3": "Audio of a comedic spoken-word ad about how nobody ever buys salt.",
    "YTDown_YouTube_Taco-Bell-Commercial-2025-USA-5-7-and-9-_Media_BpXG8kWDZ1E_002_720p.mp4": "Video of a Taco Bell commercial with burritos, drinks, and promotional offer text.",
    "YTDown_YouTube_The-Windows-Update-We-All-Wanted_Media_Kxn62gTEpIU_003_480p.mp4": "Video of a tech-news presenter discussing Windows Update while article screenshots appear on screen.",
    "YTDown_YouTube_The-Windows-Update-We-All-Wanted_Media_Kxn62gTEpIU_009_128k.mp3": "Audio of a tech-news segment about Windows Update, drivers, GPUs, and other industry stories.",
    "pexels-cottonbro-6568667.jpg": "Image of a man in dark clothing standing against a dark wall while holding papers or a notebook.",
    "pexels-cottonbro-7505174.jpg": "Image of a woman browsing books on shelves in a bright room.",
    "pexels-eva-bronzini-6475529.jpg": "Image of an envelope with letter tiles spelling IDEA.",
    "pexels-eva-bronzini-6956318.jpg": "Image of a black ribbon or wristband with the word STARTUP on a beige surface.",
    "pexels-eva-bronzini-6956354.jpg": "Image of crumpled beige paper with the word Entrepreneur printed on it.",
    "pexels-polina-zimmerman-3782140.jpg": "Image of a cork board with pinned notes including one that says HUMAN-oriented Company.",
    "pexels-tima-miroshnichenko-6474474.jpg": "Image of a hand holding a fan of paint or color swatches.",
}


def main() -> None:
    directory_path = Path(__file__).resolve().parent
    test_files_directory_path = directory_path / "test-files"
    results_path = directory_path / "results.md"

    media_file_paths = sorted(
        path
        for path in test_files_directory_path.iterdir()
        if path.is_file()
        and path.name != ".DS_Store"
        and ".json" not in path.suffixes
    )

    lines: list[str] = []
    lines.append("# Media Tagging Bake-Off")
    lines.append("")
    lines.append("## Overview")
    lines.append("")
    lines.append(
        "This report is a local-only model bake-off for media tagging and summarization."
    )
    lines.append(
        "The goal is to compare candidate pipelines for generating `tags` and `summary`"
    )
    lines.append(
        "values from images, audio, and video without using hosted APIs."
    )
    lines.append("")
    lines.append(
        "The outputs here are not production decisions by themselves. They are evidence"
    )
    lines.append(
        "for which local model stacks seem promising, which ones fail on our corpus,"
    )
    lines.append("and which subproblems should stay separate in a future pipeline.")
    lines.append("")
    lines.append("## Goals")
    lines.append("")
    lines.append(
        "- Understand what kinds of media tagging and summarization are possible cheaply inside our own infrastructure."
    )
    lines.append(
        "- Find approaches that could scale to Alpine-wide file volume without incurring per-file hosted LLM costs."
    )
    lines.append(
        "- Learn which signals are good enough for practical search, alt text, and agent-facing link text even if they are not perfect."
    )
    lines.append(
        "- Make the tradeoffs between TypeScript-native and Python-based local inference concrete in terms of quality, memory, runtime, and deployment complexity."
    )
    lines.append("")
    lines.append("## Non-goals")
    lines.append("")
    lines.append(
        "- This is not an attempt to prove that a hosted LLM would give the best output quality."
    )
    lines.append(
        "- We could likely get better descriptions by defaulting every file to an LLM, but doing that for all Alpine uploads would be very expensive."
    )
    lines.append(
        "- This is not a final production architecture decision or a commitment to ship summaries exactly as shown in this report."
    )
    lines.append(
        "- This is not an exhaustive comparison of every local model. It is a focused investigation into what looks promising under our cost and infrastructure constraints."
    )
    lines.append("")
    lines.append("## Integration")
    lines.append("")
    lines.append(
        "There are two realistic integration points for this work in Cyberworlds:"
    )
    lines.append("")
    lines.append(
        "1. Run metadata generation directly inside `processFile` in the file processor service."
    )
    lines.append(
        "   This keeps enrichment close to preview generation and guarantees that tags or summaries exist as soon as processing finishes, but it also makes the upload path slower and couples model work to a service that is currently focused on file normalization."
    )
    lines.append("")
    lines.append(
        "2. Have `processFile` schedule a follow-up metadata generation job."
    )
    lines.append(
        "   This keeps the file processor service simpler, isolates heavier OCR or ASR work, and makes it easier to swap models or retry failures later, but metadata will arrive asynchronously instead of being available immediately."
    )
    lines.append("")
    lines.append(
        "The point of this bake-off is to make that integration decision with better evidence about runtime cost, memory cost, and output quality."
    )
    lines.append("")
    lines.append(
        "One important constraint is runtime compatibility. Today, both direct `processFile` paths are built around the shared TypeScript processor library."
    )
    lines.append(
        "The legacy file processor service runs a Node-based ECS container, and the Notion importer ECS task also packages a Node binary that calls the same `processFile` code inline."
    )
    lines.append(
        "That means Python models are not a drop-in option for direct inline `processFile` integration today, even if some base images happen to contain Python-related system packages."
    )
    lines.append(
        "To use Python models directly in those paths, we would need explicit runtime support such as packaging a Python inference environment into those images, orchestrating subprocess execution from Node, or splitting metadata generation into a separate Python-capable job or service."
    )
    lines.append("")
    lines.append(
        "We would also likely derive alt text from some combination of `tags` and `summary`, depending on what we want alt text and markdown link text for agents to look like in practice."
    )
    lines.append(
        "For example, we may decide that tags are enough for search indexing while alt text should be a more human-readable sentence assembled from the same underlying signals."
    )
    lines.append("")
    lines.append("## Methodology")
    lines.append("")
    lines.append(
        "- In this report, `tags` means a short list of searchable keywords or phrases that try to capture the important visible or spoken content in a file."
    )
    lines.append(
        "- In this report, `summary` means a short text distillation of the main spoken or visible content, produced without using a hosted LLM."
    )
    lines.append(
        "- `tags` are the more likely product output because they are easier to index, easier to reason about, and generally more robust across different file types."
    )
    lines.append(
        "- `summary` is more exploratory here. A good non-LLM summary could still be interesting, especially for audio and video, but it is not yet the main bet."
    )
    lines.append(
        "- `max mem. usage` in the per-model results is the probe process RSS high-water mark reported by the local runtime and OS APIs."
    )
    lines.append(
        "- In practice, that means it is a useful approximation of how memory-heavy a run felt from the main process, but it is not a perfect measure of total machine memory, GPU memory, or every child subprocess the probe may spawn."
    )
    lines.append(
        "- We run the same local test corpus through several model stacks and save the raw outputs next to each file."
    )
    lines.append(
        "- We route files using Cyberworlds content-type detection so the experiment follows the same high-level branching we would use in the product."
    )
    lines.append(
        "- Images are judged mostly on tag quality and visible text recovery."
    )
    lines.append(
        "- Audio is judged mostly on transcript quality, transcript-derived tags, and whether the summary captures the main idea."
    )
    lines.append(
        "- Video is judged on both frame understanding and transcript quality, since tags can come from frames, visible text, or spoken content."
    )
    lines.append(
        "- We intentionally test combined pipelines because OCR, general vision understanding, and speech recognition are different subproblems and are often better handled by different local models."
    )
    lines.append(
        "- When a stack combines models, the intent is usually: dedicated OCR for visible text, a vision model for scene or object understanding, and Whisper for speech-to-text."
    )
    lines.append("")
    lines.append("## Models")
    lines.append("")
    lines.append(
        "These model stacks were chosen to cover the main decision axes we care about in this investigation:"
    )
    lines.append("")
    lines.append(
        "- a TypeScript-first local baseline that stays close to the existing Cyberworlds runtime"
    )
    lines.append(
        "- a stronger Python-based local baseline to test whether better quality justifies a separate runtime"
    )
    lines.append(
        "- OCR ablations to measure whether dedicated OCR helps beyond what the vision model can recover alone"
    )
    lines.append(
        "- model size and fine-tuning comparisons to separate the effect of raw capacity from task-specific training"
    )
    lines.append(
        "- ASR comparisons to see whether audio/video summary quality is bottlenecked more by speech recognition than by the vision stack"
    )
    lines.append("")
    lines.append(
        "The goal was not to test every possible local model. The goal was to sample a small set of representative stacks that make the major tradeoffs visible."
    )
    lines.append("")

    for model_spec in MODEL_SPECS:
        lines.append(f"### {model_spec['label']}")
        lines.append("")
        lines.append(f"- language: `{model_spec['language']}`")
        lines.append(f"- output suffix: `{model_spec['output_suffix']}`")
        lines.append(f"- notes: {model_spec['notes']}")
        lines.append("- strengths:")
        for strength in model_spec["strengths"]:
            lines.append(f"  - {strength}")
        lines.append("- work split:")
        for offload_note in model_spec["offload"]:
            lines.append(f"  - {offload_note}")
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

        for model_spec in MODEL_SPECS:
            output_path = test_files_directory_path / (
                f"{media_file_path.stem}{model_spec['output_suffix']}"
            )
            if not output_path.exists():
                lines.append(f"*{model_spec['label']}*")
                lines.append("- duration: `MISSING`")
                lines.append("- max mem. usage: `MISSING`")
                lines.append("- tags: `MISSING`")
                lines.append("- summary: `MISSING`")
                lines.append("")
                continue

            try:
                data = json.loads(output_path.read_text())
            except json.JSONDecodeError:
                lines.append(f"*{model_spec['label']}*")
                lines.append("- duration: `INVALID`")
                lines.append("- max mem. usage: `INVALID`")
                lines.append("- tags: `INVALID`")
                lines.append("- summary: `INVALID`")
                lines.append("")
                continue

            tags = data.get("final", {}).get("tags")
            summary = data.get("final", {}).get("summary")
            total_duration_ms = data.get("totalDurationMs")
            peak_rss_mib = data.get("peakRssMiB")

            lines.append(f"*{model_spec['label']}*")
            lines.append(f"- duration: `{format_elapsed_duration(total_duration_ms)}`")
            lines.append(f"- max mem. usage: `{format_memory_usage(peak_rss_mib)}`")
            lines.append(f"- tags: {render_value(tags)}")
            lines.append(f"- summary: {render_value(summary)}")
            lines.append("")

    results_path.write_text("\n".join(lines).rstrip() + "\n")


def render_value(value: object) -> str:
    if value is None:
        return "`null`"
    return f"`{json.dumps(value, ensure_ascii=False)}`"


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
    except (OSError, subprocess.CalledProcessError):
        return "n/a"

    try:
        duration_seconds = float(duration_output)
    except ValueError:
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
