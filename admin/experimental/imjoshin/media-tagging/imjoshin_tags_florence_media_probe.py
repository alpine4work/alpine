#!/usr/bin/env python3

from __future__ import annotations

import argparse
import json
import mimetypes
import os
import re
import resource
import subprocess
import sys
import tempfile
import time
import warnings
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
import psutil
import torch
from PIL import Image
from rapidocr_onnxruntime import RapidOCR
from transformers import AutoModelForCausalLM, AutoProcessor, pipeline

warnings.filterwarnings("ignore", category=FutureWarning)


stop_words = {
    "a",
    "an",
    "and",
    "are",
    "as",
    "at",
    "be",
    "behind",
    "below",
    "by",
    "for",
    "from",
    "has",
    "have",
    "he",
    "her",
    "his",
    "i",
    "if",
    "in",
    "into",
    "is",
    "it",
    "its",
    "me",
    "my",
    "no",
    "not",
    "of",
    "on",
    "or",
    "our",
    "out",
    "over",
    "she",
    "so",
    "that",
    "the",
    "their",
    "them",
    "there",
    "these",
    "they",
    "this",
    "to",
    "up",
    "us",
    "was",
    "we",
    "were",
    "what",
    "when",
    "where",
    "which",
    "who",
    "with",
    "you",
    "your",
}

caption_noise_words = {
    "against",
    "appear",
    "appears",
    "background",
    "behind",
    "bold",
    "close",
    "image",
    "left",
    "letters",
    "middle",
    "objects",
    "other",
    "page",
    "pages",
    "part",
    "piece",
    "says",
    "right",
    "side",
    "sides",
    "stands",
    "table",
    "thing",
    "words",
    "written",
    "writing",
}


@dataclass
class ProbeStage:
    currentRssMiB: float
    durationMs: float
    maxRssMiB: float
    name: str


@dataclass
class ProbeModels:
    florenceModel: Any | None
    florenceProcessor: Any | None
    rapidOcr: RapidOCR | None
    asr: Any | None


@dataclass
class MemoryTracker:
    process: psutil.Process
    peakRssMiB: float = 0

    def sampleCurrentRssMiB(self) -> float:
        current_rss_mib = self.process.memory_info().rss / (1024 * 1024)
        if current_rss_mib > self.peakRssMiB:
            self.peakRssMiB = current_rss_mib
        return current_rss_mib

    def sampleMaxRssMiB(self) -> float:
        # macOS reports ru_maxrss in bytes.
        max_rss_mib = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / (1024 * 1024)
        if max_rss_mib > self.peakRssMiB:
            self.peakRssMiB = max_rss_mib
        return self.peakRssMiB


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--file")
    parser.add_argument("--directory")
    parser.add_argument("--output-suffix", default=".florence.json")
    parser.add_argument("--florence-model", default="microsoft/Florence-2-base-ft")
    parser.add_argument("--asr-model", default="openai/whisper-base.en")
    parser.add_argument("--disable-rapid-ocr", action="store_true")
    parser.add_argument("--ffmpeg", required=True)
    parser.add_argument("--ffprobe", required=True)
    parser.add_argument("--cache-dir")
    args = parser.parse_args()

    if bool(args.file) == bool(args.directory):
        parser.error("Provide exactly one of --file or --directory")

    return args


def main() -> None:
    args = parse_args()

    if args.cache_dir:
        os.environ["HF_HOME"] = args.cache_dir
        os.environ["TRANSFORMERS_CACHE"] = args.cache_dir

    if args.file:
        result = run_probe_for_file(
            disable_rapid_ocr=args.disable_rapid_ocr,
            file_path=Path(args.file),
            florence_model_name=args.florence_model,
            asr_model_name=args.asr_model,
            ffmpeg_path=args.ffmpeg,
            ffprobe_path=args.ffprobe,
            reuse_models=None,
        )
        print(json.dumps(result, indent=2))
        return

    directory_path = Path(args.directory)
    input_file_paths = sorted(
        path
        for path in directory_path.iterdir()
        if path.is_file() and path.name != ".DS_Store" and ".json" not in path.suffixes
    )
    routes = {file_path: get_probe_route(get_content_type(file_path)) for file_path in input_file_paths}
    needs_vision = any(route in {"Image", "Video"} for route in routes.values())
    needs_asr = any(route in {"Audio", "Video"} for route in routes.values())

    shared_tracker = MemoryTracker(process=psutil.Process())
    shared_stages: list[ProbeStage] = []
    models = load_models(
        florence_model_name=args.florence_model,
        asr_model_name=args.asr_model,
        needs_asr=needs_asr,
        needs_rapid_ocr=needs_vision and not args.disable_rapid_ocr,
        needs_vision=needs_vision,
        stages=shared_stages,
        tracker=shared_tracker,
    )

    for file_path in input_file_paths:
        output_path = file_path.with_name(f"{file_path.stem}{args.output_suffix}")
        result = run_probe_for_file(
            disable_rapid_ocr=args.disable_rapid_ocr,
            file_path=file_path,
            florence_model_name=args.florence_model,
            asr_model_name=args.asr_model,
            ffmpeg_path=args.ffmpeg,
            ffprobe_path=args.ffprobe,
            reuse_models=models,
        )
        output_path.write_text(f"{json.dumps(result, indent=2)}\n")
        print(f"Wrote {output_path.name}", file=sys.stderr)


def run_probe_for_file(
    *,
    disable_rapid_ocr: bool,
    file_path: Path,
    florence_model_name: str,
    asr_model_name: str,
    ffmpeg_path: str,
    ffprobe_path: str,
    reuse_models: ProbeModels | None,
) -> dict[str, Any]:
    content_type = get_content_type(file_path)
    route = get_probe_route(content_type)
    tracker = MemoryTracker(process=psutil.Process())
    stages: list[ProbeStage] = []
    total_start_time = time.perf_counter()

    models = reuse_models
    if models is None:
        models = load_models(
            florence_model_name=florence_model_name,
            asr_model_name=asr_model_name,
            needs_asr=route in {"Audio", "Video"},
            needs_rapid_ocr=(route in {"Image", "Video"}) and not disable_rapid_ocr,
            needs_vision=route in {"Image", "Video"},
            stages=stages,
            tracker=tracker,
        )

    result = run_route(
        content_type=content_type,
        ffmpeg_path=ffmpeg_path,
        ffprobe_path=ffprobe_path,
        file_path=file_path,
        models=models,
        route=route,
        stages=stages,
        tracker=tracker,
    )

    total_duration_ms = (time.perf_counter() - total_start_time) * 1000
    peak_rss_mib = tracker.sampleMaxRssMiB()

    return {
        "contentType": content_type,
        "filePath": str(file_path),
        "final": result["final"],
        "modelInfo": {
            "asrModel": asr_model_name if route in {"Audio", "Video"} else None,
            "florenceModel": florence_model_name if route in {"Image", "Video"} else None,
            "rapidOcrEnabled": (route in {"Image", "Video"}) and not disable_rapid_ocr,
        },
        "peakRssMiB": peak_rss_mib,
        "route": route,
        "stages": [stage.__dict__ for stage in stages],
        "totalDurationMs": total_duration_ms,
        "transcript": result["transcript"],
        "transcriptSummarySourceSentences": result["transcriptSummarySourceSentences"],
        "visionDescriptions": result["visionDescriptions"],
        "visionText": result["visionText"],
    }


def load_models(
    *,
    florence_model_name: str,
    asr_model_name: str,
    needs_asr: bool,
    needs_rapid_ocr: bool,
    needs_vision: bool,
    stages: list[ProbeStage],
    tracker: MemoryTracker,
) -> ProbeModels:
    florence_model = None
    florence_processor = None
    rapid_ocr = None
    asr = None

    if needs_vision:
        florence_processor, florence_model = measure_stage(
            stages,
            tracker,
            "Load Florence vision model",
            lambda: load_florence_models(florence_model_name),
        )
        if needs_rapid_ocr:
            rapid_ocr = measure_stage(
                stages,
                tracker,
                "Load RapidOCR model",
                RapidOCR,
            )

    if needs_asr:
        asr = measure_stage(
            stages,
            tracker,
            "Load Whisper ASR model",
            lambda: pipeline("automatic-speech-recognition", model=asr_model_name),
        )

    return ProbeModels(
        florenceModel=florence_model,
        florenceProcessor=florence_processor,
        rapidOcr=rapid_ocr,
        asr=asr,
    )


def load_florence_models(model_name: str) -> tuple[Any, Any]:
    processor = AutoProcessor.from_pretrained(model_name, trust_remote_code=True)
    model = AutoModelForCausalLM.from_pretrained(model_name, trust_remote_code=True)
    model.eval()
    return processor, model


def run_route(
    *,
    content_type: str,
    ffmpeg_path: str,
    ffprobe_path: str,
    file_path: Path,
    models: ProbeModels,
    route: str,
    stages: list[ProbeStage],
    tracker: MemoryTracker,
) -> dict[str, Any]:
    if route == "Image":
        caption = measure_stage(
            stages,
            tracker,
            "Generate Florence image caption",
            lambda: florence_prompt(models, file_path, "<MORE_DETAILED_CAPTION>", 160),
        )
        florence_ocr = measure_stage(
            stages,
            tracker,
            "Run Florence OCR prompt",
            lambda: florence_prompt(models, file_path, "<OCR>", 384),
        )
        rapid_ocr_output = measure_stage(
            stages,
            tracker,
            "Run RapidOCR",
            lambda: rapid_ocr_text_if_enabled(models, file_path),
        )
        combined_ocr_text = combine_texts([florence_ocr, rapid_ocr_output])
        tags = create_image_tags(caption=caption, ocr_text=combined_ocr_text)
        return {
            "final": {"summary": None, "tags": tags},
            "transcript": None,
            "transcriptSummarySourceSentences": [],
            "visionDescriptions": {
                "frame25Caption": None,
                "frame75Caption": None,
                "imageCaption": caption,
            },
            "visionText": {
                "frame25Text": None,
                "frame75Text": None,
                "imageText": combined_ocr_text or None,
            },
        }

    if route == "Audio":
        audio = measure_stage(
            stages,
            tracker,
            "Decode audio to mono 16k float32",
            lambda: decode_audio_to_float32(ffmpeg_path, file_path),
        )
        transcript = measure_stage(
            stages,
            tracker,
            "Transcribe audio with Whisper",
            lambda: transcribe_audio(models, audio),
        )
        summary_result = measure_stage(
            stages,
            tracker,
            "Build extractive transcript summary",
            lambda: create_extractive_summary(transcript),
        )
        return {
            "final": {
                "summary": summary_result["summary"],
                "tags": extract_transcript_tags_ordered_by_use_count(transcript),
            },
            "transcript": transcript,
            "transcriptSummarySourceSentences": summary_result["sourceSentences"],
            "visionDescriptions": {
                "frame25Caption": None,
                "frame75Caption": None,
                "imageCaption": None,
            },
            "visionText": {
                "frame25Text": None,
                "frame75Text": None,
                "imageText": None,
            },
        }

    if route == "Video":
        duration_seconds = measure_stage(
            stages,
            tracker,
            "Probe video duration",
            lambda: probe_media_duration_seconds(ffprobe_path, file_path),
        )
        has_audio_stream = measure_stage(
            stages,
            tracker,
            "Probe video audio stream",
            lambda: probe_media_has_audio_stream(ffprobe_path, file_path),
        )

        with tempfile.TemporaryDirectory(prefix="imjoshin_tags_florence_media_probe_") as temp_dir:
            frame25_path = Path(temp_dir) / "frame_25.png"
            frame75_path = Path(temp_dir) / "frame_75.png"

            measure_stage(
                stages,
                tracker,
                "Extract frame at 25%",
                lambda: extract_video_frame(
                    ffmpeg_path, file_path, frame25_path, duration_seconds * 0.25
                ),
            )
            frame25_caption = measure_stage(
                stages,
                tracker,
                "Generate Florence frame caption at 25%",
                lambda: florence_prompt(models, frame25_path, "<MORE_DETAILED_CAPTION>", 160),
            )
            frame25_florence_ocr = measure_stage(
                stages,
                tracker,
                "Run Florence OCR prompt at 25%",
                lambda: florence_prompt(models, frame25_path, "<OCR>", 384),
            )
            frame25_rapid_ocr = measure_stage(
                stages,
                tracker,
                "Run RapidOCR at 25%",
                lambda: rapid_ocr_text_if_enabled(models, frame25_path),
            )
            frame25_text = combine_texts([frame25_florence_ocr, frame25_rapid_ocr])

            measure_stage(
                stages,
                tracker,
                "Extract frame at 75%",
                lambda: extract_video_frame(
                    ffmpeg_path, file_path, frame75_path, duration_seconds * 0.75
                ),
            )
            frame75_caption = measure_stage(
                stages,
                tracker,
                "Generate Florence frame caption at 75%",
                lambda: florence_prompt(models, frame75_path, "<MORE_DETAILED_CAPTION>", 160),
            )
            frame75_florence_ocr = measure_stage(
                stages,
                tracker,
                "Run Florence OCR prompt at 75%",
                lambda: florence_prompt(models, frame75_path, "<OCR>", 384),
            )
            frame75_rapid_ocr = measure_stage(
                stages,
                tracker,
                "Run RapidOCR at 75%",
                lambda: rapid_ocr_text_if_enabled(models, frame75_path),
            )
            frame75_text = combine_texts([frame75_florence_ocr, frame75_rapid_ocr])

            transcript = None
            source_sentences: list[str] = []
            summary = None

            if has_audio_stream:
                audio = measure_stage(
                    stages,
                    tracker,
                    "Decode video audio to mono 16k float32",
                    lambda: decode_audio_to_float32(ffmpeg_path, file_path),
                )
                transcript = measure_stage(
                    stages,
                    tracker,
                    "Transcribe video audio with Whisper",
                    lambda: transcribe_audio(models, audio),
                )
                summary_result = measure_stage(
                    stages,
                    tracker,
                    "Build extractive video summary",
                    lambda: create_extractive_summary(transcript),
                )
                summary = summary_result["summary"]
                source_sentences = summary_result["sourceSentences"]

        tags = create_video_tags(
            frame25_caption=frame25_caption,
            frame25_text=frame25_text,
            frame75_caption=frame75_caption,
            frame75_text=frame75_text,
            transcript=transcript,
        )
        return {
            "final": {"summary": summary, "tags": tags},
            "transcript": transcript,
            "transcriptSummarySourceSentences": source_sentences,
            "visionDescriptions": {
                "frame25Caption": frame25_caption,
                "frame75Caption": frame75_caption,
                "imageCaption": None,
            },
            "visionText": {
                "frame25Text": frame25_text or None,
                "frame75Text": frame75_text or None,
                "imageText": None,
            },
        }

    return {
        "final": {"summary": None, "tags": []},
        "transcript": None,
        "transcriptSummarySourceSentences": [],
        "visionDescriptions": {
            "frame25Caption": None,
            "frame75Caption": None,
            "imageCaption": None,
        },
        "visionText": {
            "frame25Text": None,
            "frame75Text": None,
            "imageText": None,
        },
    }


def measure_stage(
    stages: list[ProbeStage],
    tracker: MemoryTracker,
    name: str,
    fn: Any,
) -> Any:
    start_time = time.perf_counter()
    value = fn()
    duration_ms = (time.perf_counter() - start_time) * 1000
    stages.append(
        ProbeStage(
            currentRssMiB=tracker.sampleCurrentRssMiB(),
            durationMs=duration_ms,
            maxRssMiB=tracker.sampleMaxRssMiB(),
            name=name,
        )
    )
    return value


def florence_prompt(models: ProbeModels, image_path: Path, prompt: str, max_new_tokens: int) -> str:
    assert models.florenceModel is not None
    assert models.florenceProcessor is not None

    image = Image.open(image_path).convert("RGB")
    inputs = models.florenceProcessor(text=prompt, images=image, return_tensors="pt")

    with torch.no_grad():
        generated_ids = models.florenceModel.generate(
            input_ids=inputs["input_ids"],
            pixel_values=inputs["pixel_values"],
            max_new_tokens=max_new_tokens,
            num_beams=3,
        )

    raw_text = models.florenceProcessor.batch_decode(
        generated_ids, skip_special_tokens=False
    )[0]
    parsed = models.florenceProcessor.post_process_generation(
        raw_text, task=prompt, image_size=image.size
    )
    return str(parsed.get(prompt, "")).strip()


def rapid_ocr_text(models: ProbeModels, image_path: Path) -> str:
    assert models.rapidOcr is not None
    result, _ = models.rapidOcr(str(image_path))
    if not result:
        return ""
    return "\n".join(str(item[1]).strip() for item in result if len(item) > 1).strip()


def rapid_ocr_text_if_enabled(models: ProbeModels, image_path: Path) -> str:
    if models.rapidOcr is None:
        return ""
    return rapid_ocr_text(models, image_path)


def transcribe_audio(models: ProbeModels, audio: np.ndarray) -> str:
    assert models.asr is not None
    result = models.asr(
        {"array": audio, "sampling_rate": 16000},
        chunk_length_s=30,
        stride_length_s=5,
    )
    return str(result["text"]).strip()


def decode_audio_to_float32(ffmpeg_path: str, file_path: Path) -> np.ndarray:
    process = subprocess.run(
        [
            ffmpeg_path,
            "-i",
            str(file_path),
            "-vn",
            "-ac",
            "1",
            "-ar",
            "16000",
            "-f",
            "f32le",
            "-acodec",
            "pcm_f32le",
            "pipe:1",
        ],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=True,
    )
    return np.frombuffer(process.stdout, dtype=np.float32)


def probe_media_duration_seconds(ffprobe_path: str, file_path: Path) -> float:
    stdout = run_text_process(
        ffprobe_path,
        [
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            str(file_path),
        ],
    )
    return float(stdout.strip())


def probe_media_has_audio_stream(ffprobe_path: str, file_path: Path) -> bool:
    stdout = run_text_process(
        ffprobe_path,
        [
            "-v",
            "error",
            "-select_streams",
            "a",
            "-show_entries",
            "stream=index",
            "-of",
            "csv=p=0",
            str(file_path),
        ],
    )
    return bool(stdout.strip())


def extract_video_frame(
    ffmpeg_path: str, file_path: Path, output_path: Path, time_seconds: float
) -> None:
    run_text_process(
        ffmpeg_path,
        [
            "-y",
            "-ss",
            str(max(0, time_seconds)),
            "-i",
            str(file_path),
            "-frames:v",
            "1",
            str(output_path),
        ],
    )


def run_text_process(command: str, args: list[str]) -> str:
    process = subprocess.run(
        [command, *args],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=True,
        text=True,
    )
    return process.stdout


def create_extractive_summary(transcript: str) -> dict[str, Any]:
    sentences = split_sentences(transcript)
    informative_token_count = len(tokenize_for_keywords(transcript))
    if informative_token_count < 4 or len(sentences) == 0:
        return {"summary": None, "sourceSentences": []}
    if len(sentences) == 1:
        return {"summary": sentences[0], "sourceSentences": sentences}

    token_counts: dict[str, int] = {}
    for sentence in sentences:
        for token in tokenize_for_keywords(sentence):
            token_counts[token] = token_counts.get(token, 0) + 1

    ranked_sentences = []
    for index, sentence in enumerate(sentences):
        sentence_tokens = tokenize_for_keywords(sentence)
        if not sentence_tokens:
            continue
        token_score = sum(token_counts.get(token, 0) for token in sentence_tokens)
        position_boost = 1.25 if index == 0 else 1.0
        ranked_sentences.append(
            {
                "index": index,
                "score": position_boost * (token_score / max(len(sentence_tokens), 1)),
                "sentence": sentence,
            }
        )

    chosen_sentences = [
        item["sentence"]
        for item in sorted(
            sorted(ranked_sentences, key=lambda item: item["score"], reverse=True)[:2],
            key=lambda item: item["index"],
        )
    ]
    summary = " ".join(chosen_sentences).strip()
    if len(tokenize_for_keywords(summary)) < 4:
        return {"summary": None, "sourceSentences": []}
    return {"summary": summary, "sourceSentences": chosen_sentences}


def split_sentences(text: str) -> list[str]:
    return [
        sentence.strip()
        for sentence in re.split(r"(?<=[.!?])\s+|\n+", text)
        if sentence.strip()
    ]


def create_image_tags(*, caption: str, ocr_text: str) -> list[str]:
    tags: list[str] = []
    append_unique(tags, extract_short_ocr_phrases(ocr_text))
    append_unique(tags, extract_caption_keywords(caption))
    append_unique(tags, extract_keyword_tags([ocr_text]))
    return tags[:20]


def create_video_tags(
    *,
    frame25_caption: str,
    frame25_text: str,
    frame75_caption: str,
    frame75_text: str,
    transcript: str | None,
) -> list[str]:
    tags: list[str] = []
    append_unique(tags, extract_short_ocr_phrases(frame25_text))
    append_unique(tags, extract_short_ocr_phrases(frame75_text))
    append_unique(tags, extract_caption_keywords(frame25_caption))
    append_unique(tags, extract_caption_keywords(frame75_caption))
    append_unique(tags, extract_keyword_tags([frame25_text, frame75_text]))
    if transcript:
        append_unique(tags, extract_transcript_tags_ordered_by_use_count(transcript))
    return tags[:20]


def append_unique(items: list[str], additions: list[str]) -> None:
    existing = set(items)
    for addition in additions:
        if addition in existing:
            continue
        items.append(addition)
        existing.add(addition)


def extract_short_ocr_phrases(text: str) -> list[str]:
    phrases: list[str] = []
    normalized_lines = [
        normalize_spacing(raw_line)
        for raw_line in text.splitlines()
        if normalize_spacing(raw_line)
    ]
    if len(normalized_lines) > 5:
        return []

    for normalized_line in normalized_lines:
        if len(normalized_line) < 2:
            continue
        word_count = len(normalized_line.split())
        if word_count > 5 or len(normalized_line) > 40:
            continue
        phrases.append(normalized_line.lower())
    return phrases


def extract_caption_keywords(caption: str) -> list[str]:
    keywords = []
    for token in tokenize_for_keywords(caption):
        if token in caption_noise_words:
            continue
        keywords.append(token)
    return keywords


def extract_transcript_tags_ordered_by_use_count(transcript: str) -> list[str]:
    return [token for token, _count in extract_keyword_tag_counts([transcript])]


def extract_keyword_tags(texts: list[str]) -> list[str]:
    return [token for token, _count in extract_keyword_tag_counts(texts)]


def extract_keyword_tag_counts(texts: list[str]) -> list[tuple[str, int]]:
    counts: dict[str, int] = {}
    for text in texts:
        for token in tokenize_for_keywords(text):
            counts[token] = counts.get(token, 0) + 1
    return sorted(counts.items(), key=lambda item: (-item[1], item[0]))[:20]


def tokenize_for_keywords(text: str) -> list[str]:
    tokens = re.findall(r"[A-Za-z0-9][A-Za-z0-9'-]*", text)
    output: list[str] = []
    for token in tokens:
        normalized_token = token.lower()
        if normalized_token.isdigit():
            continue
        if normalized_token in stop_words:
            continue
        if len(normalized_token) > 18:
            continue
        if len(normalized_token) >= 3:
            output.append(normalized_token)
            continue
        if len(normalized_token) >= 2 and (
            (token.upper() == token and re.search(r"[A-Z]", token))
            or re.search(r"[0-9]", token)
        ):
            output.append(normalized_token)
    return output


def normalize_spacing(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def combine_texts(texts: list[str]) -> str:
    return "\n".join(text.strip() for text in texts if text.strip()).strip()


def get_content_type(file_path: Path) -> str:
    mimetypes.add_type("video/quicktime", ".mov")
    content_type, _encoding = mimetypes.guess_type(str(file_path))
    return content_type or "application/octet-stream"


def get_probe_route(content_type: str) -> str:
    if content_type.startswith("image/"):
        return "Image"
    if content_type.startswith("audio/"):
        return "Audio"
    if content_type.startswith("video/"):
        return "Video"
    return "Unsupported"


if __name__ == "__main__":
    main()
