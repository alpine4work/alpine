# Media Tagging Investigation Guide

This directory is an experimental lab for investigating local-only media tagging and summarization
options for Cyberworlds files.

The goal is not to build production code here. The goal is to compare approaches, understand
tradeoffs, and gather evidence about what kinds of local models and post-processing produce useful
`tags` and `summary` outputs for different media types.

## What This Directory Is For

- Investigating candidate approaches for enriching files with:
    - `tags: string[]`
    - `summary: string | null`
- Comparing local model stacks across:
    - images
    - audio
    - video
- Reusing Cyberworlds content-type detection so the experiments follow the same routing rules we
  would likely use in production.
- Recording results in a way that makes model quality easy to inspect across a shared test corpus.

## What This Directory Is Not For

- Production integrations
- Production schemas or migrations
- Hosted APIs or third-party inference services
- Final model selection

This directory should stay easy to iterate on, easy to rerun, and easy to throw away once we learn
what we need.

## Naming Convention

All `.py`, `.ts`, and shell entrypoint files in this directory should use the globally unique
`imjoshin_tags_*` prefix.

This keeps the experiment self-contained and avoids collisions with similarly named helper scripts
elsewhere in the repo.

## Current Experimental Approach

There are two main probe stacks here:

1. A TypeScript / Node.js probe using `@huggingface/transformers`
2. A Python probe using Florence-based vision and Whisper-based transcription
3. A TypeScript / Node.js probe using Amazon Bedrock Gemma 3 for multimodal analysis and local
   Whisper for transcription

We keep both because they answer different questions:

- The TypeScript probe shows what is practical if we want something closer to the existing JS/TS
  application stack.
- The Python probe lets us try stronger local models that are currently more mature or easier to run
  outside the JS runtime.
- The Bedrock Gemma probe lets us compare those local results against a managed multimodal model
  with direct token accounting and cost estimation.

The comparison between these stacks is the main reason this directory exists.

## File Guide

### `imjoshin_tags_file_content_probe_main.ts`

The main TypeScript proof-of-concept probe.

Why it exists:

- Tests a local JS/TS-first path
- Reuses Cyberworlds content-type detection
- Produces timings, memory usage, transcript/OCR output, tags, and summary

What it is good for:

- Fast iteration in the same language as most of the codebase
- Understanding what is possible with local Transformers.js-compatible models

### `imjoshin_tags_florence_media_probe.py`

The stronger Python-based probe.

Why it exists:

- Lets us test higher-quality local vision and ASR models
- Gives us a non-TS baseline when the JS path underperforms

What it is good for:

- Better image/video tagging and OCR than the lighter JS stack
- Comparing whether model quality gains justify a non-TS runtime

### `imjoshin_tags_test`

Convenience wrapper for the TypeScript probe.

Why it exists:

- Resolves `~` and relative paths
- Makes one-off local testing easier than typing the full Bazel command

Use it when:

- You want to test a single file quickly with the TS probe

### `imjoshin_tags_test_florence`

Convenience wrapper for the Python Florence probe.

Why it exists:

- Resolves `~` and relative paths
- Hides the Python environment and ffmpeg wiring

Use it when:

- You want to test a single file quickly with the stronger Python stack

### `imjoshin_tags_test_all`

Batch runner for the TypeScript probe over everything in `test-files/`.

Why it exists:

- Makes it easy to generate a full baseline corpus
- Overwrites sibling `*.json` outputs so results stay fresh

Use it when:

- The test corpus changed
- The TS probe changed
- You want to compare new TS behavior against previous runs

### `imjoshin_tags_test_all_florence`

Batch runner for the Python Florence probe over everything in `test-files/`.

Why it exists:

- Generates the Python comparison set for the full corpus

Use it when:

- The test corpus changed
- The Python probe changed
- You want to refresh the bake-off outputs

### `imjoshin_tags_render_results_markdown.py`

Renders the generated JSON outputs into `results.md`.

Why it exists:

- Keeps comparison reporting reproducible
- Avoids hand-editing large result tables
- Centralizes per-file human descriptions

Use it when:

- New test files are added
- New model variants are added
- Descriptions or output formatting need to change

### `imjoshin_tags_gemma_bedrock_probe_main.ts`

TypeScript probe for Amazon Bedrock Gemma 3.

Why it exists:

- Tests a managed multimodal path on the same local corpus
- Captures Bedrock token usage and estimated cost per file
- Reuses local Whisper in TypeScript so the Gemma experiment is focused on multimodal analysis
  rather than speech-to-text replacement

What it is good for:

- Measuring whether Bedrock Gemma quality is good enough for tags and summaries
- Estimating token cost for images, audio summaries, and video analysis
- Comparing a cheaper managed model path against the local Florence baseline

### `imjoshin_tags_test_gemma`

Convenience wrapper for the Bedrock Gemma probe.

Why it exists:

- Resolves `~` and relative paths
- Hides the Bazel entrypoint and ffmpeg wiring

Use it when:

- You want to test one image, audio file, or video with Bedrock Gemma

### `imjoshin_tags_test_all_gemma`

Batch runner for the Bedrock Gemma probe over everything in `test-files/`.

Why it exists:

- Generates the Bedrock comparison set for the full corpus
- Writes sibling `.gemma.json` files for rendering and comparison
- Keeps the Bedrock path in TypeScript so it can be compared more directly with the existing JS/TS
  codebase

Use it when:

- The test corpus changed
- The Gemma prompt, frame sampling, or cost logic changed
- You want to refresh `results-gemma.md`

### `imjoshin_tags_render_gemma_results_markdown.py`

Renders the Gemma JSON outputs into `results-gemma.md`.

Why it exists:

- Keeps the Bedrock comparison report reproducible
- Adds token usage and estimated cost fields that are specific to the Gemma experiment
- Produces a separate report so the local-only bake-off remains readable

Use it when:

- New `.gemma.json` outputs are generated
- The token or cost summary format changes
- New descriptions or result fields are added

### `results.md`

Human-readable bake-off report for this experiment.

Why it exists:

- Records what each model produced for each test file
- Makes it easy to compare tags and summaries side-by-side
- Acts as the running log of investigation results

This file should stay current with the latest relevant runs.

### `results-gemma.md`

Human-readable bake-off report for the Bedrock Gemma experiment.

Why it exists:

- Records Bedrock token usage and estimated cost next to tags and summaries
- Makes it easy to compare per-image, per-audio, and per-video cost
- Keeps the managed-model investigation separate from the local-only report

This file should stay current with the latest relevant runs.

### `test-files/`

Local corpus of images, audio files, and videos used for evaluation.

Why it exists:

- Gives us a shared set of examples to compare model quality
- Includes both easy cases and failure cases

This directory is intentionally local and ignored by git.

### `BUILD`

Bazel entrypoint for the TS probe and package checks.

Why it exists:

- Keeps the experiment runnable within Cyberworlds tooling

## How To Run Things

Run the TypeScript probe directly:

```bash
bazel run //admin/experimental/imjoshin/media-tagging:file_content_probe -- --file=/absolute/path/to/file
```

Run the TypeScript wrapper:

```bash
./admin/experimental/imjoshin/media-tagging/imjoshin_tags_test ~/Documents/file.png
./admin/experimental/imjoshin/media-tagging/imjoshin_tags_test ../../Downloads/file.mp4 --asrModel=Xenova/whisper-tiny.en
```

Run the Python Florence wrapper:

```bash
./admin/experimental/imjoshin/media-tagging/imjoshin_tags_test_florence ~/Documents/file.png
```

Run the Bedrock Gemma wrapper:

```bash
./admin/experimental/imjoshin/media-tagging/imjoshin_tags_test_gemma ~/Documents/file.png
```

Run the TypeScript probe across the whole corpus:

```bash
./admin/experimental/imjoshin/media-tagging/imjoshin_tags_test_all
```

Run the Python Florence probe across the whole corpus:

```bash
./admin/experimental/imjoshin/media-tagging/imjoshin_tags_test_all_florence
```

Run the Bedrock Gemma probe across the whole corpus:

```bash
./admin/experimental/imjoshin/media-tagging/imjoshin_tags_test_all_gemma
```

Regenerate the markdown bake-off report:

```bash
python3 ./admin/experimental/imjoshin/media-tagging/imjoshin_tags_render_results_markdown.py
```

Regenerate the Bedrock Gemma markdown report:

```bash
python3 ./admin/experimental/imjoshin/media-tagging/imjoshin_tags_render_gemma_results_markdown.py
```

Run package checks:

```bash
bazel test //admin/experimental/imjoshin/media-tagging/...
```

## Expected Outputs

Each probe output is meant to help us judge both quality and feasibility.

Typical output includes:

- detected Cyberworlds content type
- stage-by-stage timings
- memory usage / peak RSS observations
- OCR text and/or transcript text
- final `tags`
- final `summary`
- Bedrock input/output token counts and estimated token cost for the Gemma probe

Batch runs write sibling JSON files next to the media in `test-files/` so they can be compared and
rendered into `results.md`.

## Maintenance Rules

Update this `AGENTS.md` whenever relevant information changes or is added.

That includes:

- adding or removing scripts
- changing what a script does
- introducing a new model family or runtime
- changing how results are rendered or compared
- adding important workflow steps
- discovering new caveats that future contributors should know

If someone would have to read the code to understand the new workflow, this file should probably be
updated too.

## Working Style For This Directory

- Prefer clear experiments over clever abstractions
- Keep outputs easy to compare across model variants
- Preserve evidence of failure modes, not just successful runs
- Favor reproducibility over convenience when the two conflict
- Document why a new script or model exists before the directory grows more complex
