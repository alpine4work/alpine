# Media Tagging Bake-Off

## Overview

This report is a local-only model bake-off for media tagging and summarization. The goal is to
compare candidate pipelines for generating `tags` and `summary` values from images, audio, and video
without using hosted APIs.

The outputs here are not production decisions by themselves. They are evidence for which local model
stacks seem promising, which ones fail on our corpus, and which subproblems should stay separate in
a future pipeline.

## Goals

- Understand what kinds of media tagging and summarization are possible cheaply inside our own
  infrastructure.
- Find approaches that could scale to Alpine-wide file volume without incurring per-file hosted LLM
  costs.
- Learn which signals are good enough for practical search, alt text, and agent-facing link text
  even if they are not perfect.
- Make the tradeoffs between TypeScript-native and Python-based local inference concrete in terms of
  quality, memory, runtime, and deployment complexity.

## Non-goals

- This is not an attempt to prove that a hosted LLM would give the best output quality.
- We could likely get better descriptions by defaulting every file to an LLM, but doing that for all
  Alpine uploads would be very expensive.
- This is not a final production architecture decision or a commitment to ship summaries exactly as
  shown in this report.
- This is not an exhaustive comparison of every local model. It is a focused investigation into what
  looks promising.

## Integration

There are two realistic integration points for this work in Cyberworlds:

1. Run metadata generation directly inside `processFile` in the file processor service. This keeps
   enrichment close to preview generation and guarantees that tags or summaries exist as soon as
   processing finishes, but it also makes the upload path slower and couples model work to a service
   that is currently focused on file normalization.

2. Have `processFile` schedule a follow-up metadata generation job. This keeps the file processor
   service simpler, isolates heavier OCR or ASR work, and makes it easier to swap models or retry
   failures later, but metadata will arrive asynchronously instead of being available immediately.

The point of this bake-off is to make that integration decision with better evidence about runtime
cost, memory cost, and output quality.

One important constraint is runtime compatibility. Today, both direct `processFile` paths are built
around the shared TypeScript processor library. The legacy file processor service runs a Node-based
ECS container, and the Notion importer ECS task also packages a Node binary that calls the same
`processFile` code inline. That means Python models are not a drop-in option for direct inline
`processFile` integration today, even if some base images happen to contain Python-related system
packages. To use Python models directly in those paths, we would need explicit runtime support such
as packaging a Python inference environment into those images, orchestrating subprocess execution
from Node, or splitting metadata generation into a separate Python-capable job or service.

We would also likely derive alt text from some combination of `tags` and `summary`, depending on
what we want alt text and markdown link text for agents to look like in practice. For example, we
may decide that tags are enough for search indexing while alt text should be a more human-readable
sentence assembled from the same underlying signals.

## Methodology

- In this report, `tags` means a short list of searchable keywords or phrases that try to capture
  the important visible or spoken content in a file.
    - `tags` are the more likely product output because they are easier to index, easier to reason
      about, and generally more robust across different file types.
- In this report, `summary` means a short text distillation of the main spoken or visible content,
  produced without using a hosted LLM.
    - `summary` is more exploratory here. A good non-LLM summary could still be interesting,
      especially for audio and video, but it is not yet the main bet.
- `max mem. usage` in the per-model results is the probe process RSS high-water mark reported by the
  local runtime and OS APIs.
- In practice, that means it is a useful approximation of how memory-heavy a run felt from the main
  process, but it is not a perfect measure of total machine memory, GPU memory, or every child
  subprocess the probe may spawn.
- We run the same local test corpus through several model stacks and save the raw outputs next to
  each file.
- We route files using Cyberworlds content-type detection so the experiment follows the same
  high-level branching we would use in the product.
- Images are judged mostly on tag quality and visible text recovery.
- Audio is judged mostly on transcript quality, transcript-derived tags, and whether the summary
  captures the main idea.
- Video is judged on both frame understanding and transcript quality, since tags can come from
  frames, visible text, or spoken content.
- We intentionally test combined pipelines because OCR, general vision understanding, and speech
  recognition are different subproblems and are often better handled by different local models.
- When a stack combines models, the intent is usually: dedicated OCR for visible text, a vision
  model for scene or object understanding, and Whisper for speech-to-text.

## Models

These model stacks were chosen to cover the main decision axes we care about in this investigation:

- a TypeScript-first local baseline that stays close to the existing Cyberworlds runtime
- a stronger Python-based local baseline to test whether better quality justifies a separate runtime
- OCR ablations to measure whether dedicated OCR helps beyond what the vision model can recover
  alone
- model size and fine-tuning comparisons to separate the effect of raw capacity from task-specific
  training
- ASR comparisons to see whether audio/video summary quality is bottlenecked more by speech
  recognition than by the vision stack

The goal was not to test every possible local model. The goal was to sample a small set of
representative stacks that make the major tradeoffs visible.

### Xenova JS Baseline

- language: `TypeScript / Node.js`
- output suffix: `.json`
- notes: Xenova TrOCR + ViT caption/classifier + Whisper tiny
- strengths:
    - Best reference for a JS/TS-native local stack that stays close to the rest of the codebase.
    - Fastest stack to iterate on when we want to test routing, memory, and batching behavior from
      Node.js.
    - Useful baseline for understanding how far a lightweight local stack can go before quality
      falls off.
- work split:
    - OCR is handled by TrOCR because it is lightweight and easy to run from Transformers.js.
    - Image understanding is handled by ViT captioning and classification because the goal is a
      simple local visual baseline without a Python runtime.
    - Speech recognition is handled by Whisper tiny because it is small enough to keep the JS path
      practical, even though transcript quality is weaker.

### Florence-2-base-ft + RapidOCR + Whisper-base.en

- language: `Python`
- output suffix: `.florence.json`
- notes: Best current Python probe baseline
- strengths:
    - Best overall quality so far across mixed image, video, and audio cases.
    - Handles screenshots, UI, scenes, and OCR-heavy frames more reliably than the JS baseline.
    - Good default comparison point for new files because it balances quality and runtime cost.
- work split:
    - Vision tagging and frame understanding are handled by Florence-2-base-ft because it is the
      strongest all-around local image model we have tested in this directory.
    - OCR is offloaded to RapidOCR because dedicated OCR often recovers short visible text better
      than relying on Florence alone.
    - Transcription is offloaded to Whisper base because it produces meaningfully better transcripts
      than Whisper tiny while staying manageable locally.

### Florence-2-base-ft + Whisper-base.en

- language: `Python`
- output suffix: `.florence-no-rapidocr.json`
- notes: Florence OCR/caption only, no RapidOCR
- strengths:
    - Shows how much Florence can do on its own without a separate OCR helper.
    - Useful for measuring whether RapidOCR actually improves text-heavy media or just adds
      complexity.
    - Simpler stack shape when we want fewer moving parts in the pipeline.
- work split:
    - Vision tagging, captioning, and OCR-like extraction are all pushed onto Florence-2-base-ft to
      test a more self-contained vision path.
    - Transcription is still offloaded to Whisper base because Florence is not our speech model.

### Florence-2-base + RapidOCR + Whisper-base.en

- language: `Python`
- output suffix: `.florence-base.json`
- notes: Non fine-tuned Florence base
- strengths:
    - Useful control for understanding how much the fine-tuning in `base-ft` is helping.
    - Sometimes produces broader scene descriptions that are helpful for open-ended visual content.
    - Good comparison point when fine-tuned behavior looks overfit or oddly literal.
- work split:
    - General vision understanding is handled by Florence-2-base so we can compare base versus
      fine-tuned Florence directly.
    - OCR is offloaded to RapidOCR for the same reason as the main Florence stack: better recovery
      of explicit text when it is present.
    - Transcription is offloaded to Whisper base to keep the audio side constant while we isolate
      the vision model difference.

### Florence-2-large-ft + RapidOCR + Whisper-base.en

- language: `Python`
- output suffix: `.florence-large-ft.json`
- notes: Large fine-tuned Florence
- strengths:
    - Best candidate when we want to see whether more vision capacity improves difficult frames.
    - Often produces richer scene tags than the smaller models on visually dense content.
    - Useful for checking whether a stronger vision model is worth the extra memory and runtime
      cost.
- work split:
    - Vision understanding is offloaded to Florence-2-large-ft to test whether a larger fine-tuned
      model improves tagging quality on harder media.
    - OCR is offloaded to RapidOCR because the larger Florence model still benefits from a dedicated
      text extractor.
    - Transcription stays on Whisper base so differences are mostly attributable to the vision model
      size.

### Florence-2-large + RapidOCR + Whisper-base.en

- language: `Python`
- output suffix: `.florence-large.json`
- notes: Large non fine-tuned Florence
- strengths:
    - Measures whether larger raw model capacity helps more than fine-tuning for our media set.
    - Good sanity check when large-ft and base-ft disagree in surprising ways.
    - Can surface whether our best results come from model size or task-specific tuning.
- work split:
    - Vision understanding is offloaded to Florence-2-large so we can separate the effect of model
      size from the effect of fine-tuning.
    - OCR remains on RapidOCR because visible text extraction is still a distinct subproblem from
      general scene understanding.
    - Transcription remains on Whisper base so the comparison isolates the vision stack.

### Florence-2-base-ft + RapidOCR + Whisper-small.en

- language: `Python`
- output suffix: `.florence-whisper-small.json`
- notes: Same vision stack with a stronger Whisper model
- strengths:
    - Best comparison for asking whether transcript quality is the main bottleneck on audio and
      video summaries.
    - Useful when the visual tags are already good but the transcript-driven summary still feels
      weak.
    - Helps isolate whether ASR upgrades are more valuable than further vision model changes.
- work split:
    - Vision tagging stays on Florence-2-base-ft because this variant is meant to keep the visual
      side fixed.
    - OCR stays on RapidOCR because text extraction is not the variable being tested here.
    - Transcription is offloaded to Whisper small to test whether a stronger ASR model materially
      improves summaries and transcript-derived tags.

## Results

### 12987324_3840_2160_30fps.mp4

Description: Video of an aerial view over a road and a construction or village area.

File Metadata: File Size: 206 MiB, Duration: 0m46s, Content Type: `video/mp4`

_Xenova JS Baseline_

- duration: `0m08s`
- max mem. usage: `2.51 GiB`
- tags: `["town", "train", "tracks", "dirt", "road", "field", "man", "bike"]`
- summary: `null`

_Florence-2-base-ft + RapidOCR + Whisper-base.en_

- duration: `0m19s`
- max mem. usage: `5.52 GiB`
- tags:
  `["aerial", "view", "large", "open", "field", "green", "grass", "white", "fence", "trees", "next", "dirt", "road", "small", "brown", "building", "red", "people", "walking", "front"]`
- summary: `null`

_Florence-2-base-ft + Whisper-base.en_

- duration: `0m15s`
- max mem. usage: `2.25 GiB`
- tags:
  `["aerial", "view", "large", "open", "field", "green", "grass", "white", "fence", "trees", "next", "dirt", "road", "small", "brown", "building", "red", "people", "walking", "front"]`
- summary: `null`

_Florence-2-base + RapidOCR + Whisper-base.en_

- duration: `0m21s`
- max mem. usage: `5.61 GiB`
- tags:
  `["٠٠", "shows", "aerial", "view", "construction", "site", "located", "rural", "area", "green", "fields", "ground", "covered", "dirt", "large", "pile", "center", "several", "buildings", "structures"]`
- summary: `null`

_Florence-2-large-ft + RapidOCR + Whisper-base.en_

- duration: `0m30s`
- max mem. usage: `7.80 GiB`
- tags:
  `["aerial", "view", "farm", "large", "green", "fields", "dirt", "road", "field", "several", "buildings", "surrounding", "construction", "site", "roads", "been", "stripped", "any", "red", "white"]`
- summary: `null`

_Florence-2-large + RapidOCR + Whisper-base.en_

- duration: `0m37s`
- max mem. usage: `8.66 GiB`
- tags:
  `["shows", "aerial", "view", "construction", "site", "rural", "area", "process", "being", "built", "large", "pile", "dirt", "center", "surrounded", "fence", "several", "buildings", "structures", "scattered"]`
- summary: `null`

_Florence-2-base-ft + RapidOCR + Whisper-small.en_

- duration: `0m19s`
- max mem. usage: `5.98 GiB`
- tags:
  `["aerial", "view", "large", "open", "field", "green", "grass", "white", "fence", "trees", "next", "dirt", "road", "small", "brown", "building", "red", "people", "walking", "front"]`
- summary: `null`

### 12987350_3840_2160_30fps.mp4

Description: Video of an aerial view over farm fields, dirt roads, and scattered buildings.

File Metadata: File Size: 51.7 MiB, Duration: 0m13s, Content Type: `video/mp4`

_Xenova JS Baseline_

- duration: `0m08s`
- max mem. usage: `2.46 GiB`
- tags: `["building", "lot", "trees", "field", "fence", "atx", "ax"]`
- summary: `null`

_Florence-2-base-ft + RapidOCR + Whisper-base.en_

- duration: `0m18s`
- max mem. usage: `5.98 GiB`
- tags:
  `["aerial", "view", "farm", "large", "fields", "green", "brown", "tree", "field", "buildings", "distance", "white", "roads", "made", "dirt", "trees", "tall", "surrounded", "rows", "tractor"]`
- summary: `null`

_Florence-2-base-ft + Whisper-base.en_

- duration: `0m16s`
- max mem. usage: `2.30 GiB`
- tags:
  `["aerial", "view", "farm", "large", "fields", "green", "brown", "tree", "field", "buildings", "distance", "white", "roads", "made", "dirt", "trees", "tall", "surrounded", "rows", "tractor"]`
- summary: `null`

_Florence-2-base + RapidOCR + Whisper-base.en_

- duration: `0m21s`
- max mem. usage: `6.37 GiB`
- tags:
  `["aerial", "view", "large", "agricultural", "area", "surrounded", "green", "fields", "several", "roads", "highways", "running", "through", "made", "dirt", "process", "being", "built", "small", "tree"]`
- summary: `null`

_Florence-2-large-ft + RapidOCR + Whisper-base.en_

- duration: `0m27s`
- max mem. usage: `8.77 GiB`
- tags:
  `["aerial", "view", "farm", "rows", "green", "grass", "field", "large", "tree", "fields", "front", "building", "dirt", "road", "between"]`
- summary: `null`

_Florence-2-large + RapidOCR + Whisper-base.en_

- duration: `0m37s`
- max mem. usage: `8.66 GiB`
- tags:
  `["shows", "aerial", "view", "construction", "site", "rural", "area", "surrounded", "green", "fields", "several", "buildings", "structures", "scattered", "throughout", "center", "large", "dirt", "road", "process"]`
- summary: `null`

_Florence-2-base-ft + RapidOCR + Whisper-small.en_

- duration: `0m19s`
- max mem. usage: `6.07 GiB`
- tags:
  `["aerial", "view", "farm", "large", "fields", "green", "brown", "tree", "field", "buildings", "distance", "white", "roads", "made", "dirt", "trees", "tall", "surrounded", "rows", "tractor"]`
- summary: `null`

### 13986302_2160_3840_25fps.mp4

Description: Video of a blue-gloved hand using a small lab machine or centrifuge.

File Metadata: File Size: 18.1 MiB, Duration: 0m16s, Content Type: `video/mp4`

_Xenova JS Baseline_

- duration: `0m05s`
- max mem. usage: `2.68 GiB`
- tags: `["person", "cleaning", "sink", "blue", "cloth", "toothbrush", "toothpaste", "cup"]`
- summary: `null`

_Florence-2-base-ft + RapidOCR + Whisper-base.en_

- duration: `0m16s`
- max mem. usage: `6.36 GiB`
- tags:
  `["caut", "white", "machine", "sitting", "blue", "glove", "four", "buttons", "colored", "red", "yellow", "green", "washing", "top", "open", "button", "black", "hose", "wall", "beige"]`
- summary: `null`

_Florence-2-base-ft + Whisper-base.en_

- duration: `0m14s`
- max mem. usage: `2.32 GiB`
- tags:
  `["caution", "caut", "white", "machine", "sitting", "blue", "glove", "four", "buttons", "colored", "red", "yellow", "green", "washing", "top", "open", "button", "black", "hose", "wall"]`
- summary: `null`

_Florence-2-base + RapidOCR + Whisper-base.en_

- duration: `0m19s`
- max mem. usage: `6.84 GiB`
- tags:
  `["caut", "shows", "close-up", "laboratory", "equipment", "specifically", "centrifuge", "white", "color", "circular", "base", "four", "colorful", "buttons", "center", "arranged", "pattern", "different", "colors", "red"]`
- summary: `null`

_Florence-2-large-ft + RapidOCR + Whisper-base.en_

- duration: `0m28s`
- max mem. usage: `8.77 GiB`
- tags:
  `["caut", "white", "machine", "sitting", "colorful", "buttons", "front", "blue", "glove", "person's", "hand", "room", "knobs", "top", "black", "cord", "coming", "lid", "make", "read"]`
- summary: `null`

_Florence-2-large + RapidOCR + Whisper-base.en_

- duration: `0m35s`
- max mem. usage: `9.55 GiB`
- tags:
  `["caut", "shows", "close-up", "laboratory", "equipment", "specifically", "centrifuge", "white", "color", "circular", "base", "four", "colorful", "buttons", "center", "arranged", "pattern", "different", "colors", "red"]`
- summary: `null`

_Florence-2-base-ft + RapidOCR + Whisper-small.en_

- duration: `0m16s`
- max mem. usage: `6.17 GiB`
- tags:
  `["caut", "white", "machine", "sitting", "blue", "glove", "four", "buttons", "colored", "red", "yellow", "green", "washing", "top", "open", "button", "black", "hose", "wall", "beige"]`
- summary: `null`

### 6567878-uhd_2160_4096_25fps.mp4

Description: Video of a man presenting while standing against a dark wall and holding objects in his
hands.

File Metadata: File Size: 44.0 MiB, Duration: 0m33s, Content Type: `video/mp4`

_Xenova JS Baseline_

- duration: `0m06s`
- max mem. usage: `2.49 GiB`
- tags: `["man", "laptop", "black", "shirt", "cell", "phone", "paper", "background"]`
- summary: `null`

_Florence-2-base-ft + RapidOCR + Whisper-base.en_

- duration: `0m15s`
- max mem. usage: `6.59 GiB`
- tags:
  `["man", "standing", "front", "gray", "wall", "wearing", "black", "suit", "white", "shirt", "underneath", "holding", "square", "object", "hands", "dark", "brown", "hair", "beard", "blue"]`
- summary: `null`

_Florence-2-base-ft + Whisper-base.en_

- duration: `0m12s`
- max mem. usage: `2.36 GiB`
- tags:
  `["man", "standing", "front", "gray", "wall", "wearing", "black", "suit", "white", "shirt", "underneath", "holding", "square", "object", "hands", "dark", "brown", "hair", "beard", "blue"]`
- summary: `null`

_Florence-2-base + RapidOCR + Whisper-base.en_

- duration: `0m18s`
- max mem. usage: `7.55 GiB`
- tags:
  `["shows", "young", "man", "beard", "glasses", "wearing", "dark", "blue", "blazer", "white", "shirt", "standing", "front", "plain", "grey", "holding", "small", "rectangular", "object", "hand"]`
- summary: `null`

_Florence-2-large-ft + RapidOCR + Whisper-base.en_

- duration: `0m28s`
- max mem. usage: `8.87 GiB`
- tags:
  `["man", "wearing", "dark", "blue", "suit", "brown", "hair", "beard", "glasses", "holding", "paper", "one", "hand", "object", "wall", "white", "standing", "front", "gray", "black"]`
- summary: `null`

_Florence-2-large + RapidOCR + Whisper-base.en_

- duration: `0m34s`
- max mem. usage: `9.55 GiB`
- tags:
  `["shows", "man", "dark", "blue", "suit", "glasses", "standing", "grey", "holding", "small", "rectangular", "object", "hand", "pointing", "book", "tablet", "black", "cover", "white", "beard"]`
- summary: `null`

_Florence-2-base-ft + RapidOCR + Whisper-small.en_

- duration: `0m16s`
- max mem. usage: `6.63 GiB`
- tags:
  `["man", "standing", "front", "gray", "wall", "wearing", "black", "suit", "white", "shirt", "underneath", "holding", "square", "object", "hands", "dark", "brown", "hair", "beard", "blue"]`
- summary: `null`

### F33A4268-2.jpg

Description: Image of a close-up green plant against a blurred background.

File Metadata: File Size: 0.37 MiB, Duration: n/a, Content Type: `image/jpeg`

_Xenova JS Baseline_

- duration: `0m03s`
- max mem. usage: `2.58 GiB`
- tags: `["green", "plant", "refund"]`
- summary: `null`

_Florence-2-base-ft + RapidOCR + Whisper-base.en_

- duration: `0m09s`
- max mem. usage: `7.21 GiB`
- tags: `["plant", "blurry", "small", "green", "leaves", "look", "like", "spikes"]`
- summary: `null`

_Florence-2-base-ft + Whisper-base.en_

- duration: `0m05s`
- max mem. usage: `2.44 GiB`
- tags: `["plant", "blurry", "small", "green", "leaves", "look", "like", "spikes"]`
- summary: `null`

_Florence-2-base + RapidOCR + Whisper-base.en_

- duration: `0m09s`
- max mem. usage: `8.12 GiB`
- tags:
  `["courtesy photography", "close-up", "plant", "long", "thin", "leaves", "pale", "green", "color", "slightly", "curled", "tips", "growing", "natural", "environment", "plants", "visible", "taken", "elevated", "angle"]`
- summary: `null`

_Florence-2-large-ft + RapidOCR + Whisper-base.en_

- duration: `0m14s`
- max mem. usage: `9.13 GiB`
- tags:
  `["courtesy of the water", "plant", "green", "leaves", "blurry", "pointed", "tips", "courtesy", "water"]`
- summary: `null`

_Florence-2-large + RapidOCR + Whisper-base.en_

- duration: `0m17s`
- max mem. usage: `9.55 GiB`
- tags:
  `["close-up", "plant", "long", "thin", "leaves", "light", "green", "color", "fresh", "healthy", "growing", "natural", "environment", "plants", "visible", "taken", "low", "angle", "making", "focal"]`
- summary: `null`

_Florence-2-base-ft + RapidOCR + Whisper-small.en_

- duration: `0m08s`
- max mem. usage: `7.08 GiB`
- tags: `["plant", "blurry", "small", "green", "leaves", "look", "like", "spikes"]`
- summary: `null`

### IMG_3138.jpg

Description: Image of a baby sitting on a black blanket in front of a dark backdrop.

File Metadata: File Size: 0.35 MiB, Duration: n/a, Content Type: `image/jpeg`

_Xenova JS Baseline_

- duration: `0m03s`
- max mem. usage: `2.52 GiB`
- tags: `["baby", "bed", "paper"]`
- summary: `null`

_Florence-2-base-ft + RapidOCR + Whisper-base.en_

- duration: `0m08s`
- max mem. usage: `7.21 GiB`
- tags:
  `["baby", "sitting", "black", "blanket", "wearing", "blue", "white", "checkered", "shirt", "pants"]`
- summary: `null`

_Florence-2-base-ft + Whisper-base.en_

- duration: `0m05s`
- max mem. usage: `2.47 GiB`
- tags:
  `["baby", "sitting", "black", "blanket", "wearing", "blue", "white", "checkered", "shirt", "pants"]`
- summary: `null`

_Florence-2-base + RapidOCR + Whisper-base.en_

- duration: `0m09s`
- max mem. usage: `8.48 GiB`
- tags:
  `["portrait", "baby", "sitting", "black", "blanket", "wearing", "blue", "white", "checkered", "shirt", "beige", "pants", "big", "smile", "face", "looking", "directly", "camera", "completely", "making"]`
- summary: `null`

_Florence-2-large-ft + RapidOCR + Whisper-base.en_

- duration: `0m14s`
- max mem. usage: `9.13 GiB`
- tags:
  `["12", "baby", "sitting", "black", "blanket", "wearing", "blue", "white", "checkered", "shirt", "pants"]`
- summary: `null`

_Florence-2-large + RapidOCR + Whisper-base.en_

- duration: `0m16s`
- max mem. usage: `10.32 GiB`
- tags:
  `["portrait", "baby", "sitting", "black", "blanket", "wearing", "blue", "white", "checkered", "shirt", "beige", "pants", "legs", "crossed", "hands", "resting", "knees", "completely", "making", "focal"]`
- summary: `null`

_Florence-2-base-ft + RapidOCR + Whisper-small.en_

- duration: `0m08s`
- max mem. usage: `8.81 GiB`
- tags:
  `["baby", "sitting", "black", "blanket", "wearing", "blue", "white", "checkered", "shirt", "pants"]`
- summary: `null`

### IMG_3479.jpg

Description: Image of a baby sitting in a shopping cart and holding a snack.

File Metadata: File Size: 2.77 MiB, Duration: n/a, Content Type: `image/jpeg`

_Xenova JS Baseline_

- duration: `0m03s`
- max mem. usage: `2.61 GiB`
- tags: `["shopping cart", "shopping", "cart", "baby", "bench", "donut"]`
- summary: `null`

_Florence-2-base-ft + RapidOCR + Whisper-base.en_

- duration: `0m09s`
- max mem. usage: `7.60 GiB`
- tags:
  `["super", "little", "boy", "sitting", "shopping", "cart", "wearing", "black", "hat", "grey", "shirt", "word", "holding", "food", "hand", "woman", "standing"]`
- summary: `null`

_Florence-2-base-ft + Whisper-base.en_

- duration: `0m06s`
- max mem. usage: `2.52 GiB`
- tags:
  `["super", "little", "boy", "sitting", "shopping", "cart", "wearing", "black", "hat", "grey", "shirt", "word", "holding", "food", "hand", "woman", "standing"]`
- summary: `null`

_Florence-2-base + RapidOCR + Whisper-base.en_

- duration: `0m09s`
- max mem. usage: `8.64 GiB`
- tags:
  `["super", "shows", "baby", "sitting", "shopping", "cart", "wearing", "black", "beanie", "red", "yellow", "logo", "grey", "t-shirt", "word", "holding", "pizza", "hand", "looking", "directly"]`
- summary: `null`

_Florence-2-large-ft + RapidOCR + Whisper-base.en_

- duration: `0m16s`
- max mem. usage: `9.13 GiB`
- tags:
  `["super", "baby", "boy", "sitting", "red", "shopping", "cart", "wearing", "black", "knit", "cap", "patch", "front", "shirt", "gray", "superman", "logo", "blue", "jeans", "holding"]`
- summary: `null`

_Florence-2-large + RapidOCR + Whisper-base.en_

- duration: `0m18s`
- max mem. usage: `10.32 GiB`
- tags:
  `["super", "shows", "young", "child", "probably", "around", "2-3", "years", "old", "sitting", "red", "shopping", "cart", "wearing", "black", "beanie", "yellow", "logo", "grey", "t-shirt"]`
- summary: `null`

_Florence-2-base-ft + RapidOCR + Whisper-small.en_

- duration: `0m09s`
- max mem. usage: `8.81 GiB`
- tags:
  `["super", "little", "boy", "sitting", "shopping", "cart", "wearing", "black", "hat", "grey", "shirt", "word", "holding", "food", "hand", "woman", "standing"]`
- summary: `null`

### IMG_6153.jpg

Description: Image of an Alpine-stickered laptop and a mug on a wooden table in bright sunlight.

File Metadata: File Size: 0.09 MiB, Duration: n/a, Content Type: `image/jpeg`

_Xenova JS Baseline_

- duration: `0m03s`
- max mem. usage: `2.45 GiB`
- tags: `["laptop", "computer", "wooden", "table"]`
- summary: `null`

_Florence-2-base-ft + RapidOCR + Whisper-base.en_

- duration: `0m05s`
- max mem. usage: `7.60 GiB`
- tags:
  `["alpine", "npine", "black", "laptop", "sitting", "wooden", "mug", "next", "colorful", "stickers", "screen"]`
- summary: `null`

_Florence-2-base-ft + Whisper-base.en_

- duration: `0m05s`
- max mem. usage: `2.52 GiB`
- tags:
  `["alpine", "black", "laptop", "sitting", "wooden", "mug", "next", "colorful", "stickers", "screen"]`
- summary: `null`

_Florence-2-base + RapidOCR + Whisper-base.en_

- duration: `0m07s`
- max mem. usage: `8.64 GiB`
- tags:
  `["alpine", "npine", "shows", "laptop", "wooden", "black", "mug", "open", "screen", "displaying", "set", "stickers", "word", "different", "colors", "designs", "including", "bear", "cat", "dog"]`
- summary: `null`

_Florence-2-large-ft + RapidOCR + Whisper-base.en_

- duration: `0m11s`
- max mem. usage: `9.13 GiB`
- tags: `["alpine", "npine", "laptop", "sitting", "black", "mug", "next", "stickers", "computer"]`
- summary: `null`

_Florence-2-large + RapidOCR + Whisper-base.en_

- duration: `0m14s`
- max mem. usage: `10.32 GiB`
- tags:
  `["alpine", "npine", "shows", "laptop", "coffee", "mug", "wooden", "open", "screen", "turned", "several", "stickers", "word", "cursive", "font", "different", "colors", "designs", "blurred", "but"]`
- summary: `null`

_Florence-2-base-ft + RapidOCR + Whisper-small.en_

- duration: `0m05s`
- max mem. usage: `8.81 GiB`
- tags:
  `["alpine", "npine", "black", "laptop", "sitting", "wooden", "mug", "next", "colorful", "stickers", "screen"]`
- summary: `null`

### IMG_6164.jpg

Description: Image of four adults standing on a red dirt trail with red rock mountains behind them.

File Metadata: File Size: 0.57 MiB, Duration: n/a, Content Type: `image/jpeg`

_Xenova JS Baseline_

- duration: `0m02s`
- max mem. usage: `2.48 GiB`
- tags: `["three", "people", "dirt", "road", "qty"]`
- summary: `null`

_Florence-2-base-ft + RapidOCR + Whisper-base.en_

- duration: `0m06s`
- max mem. usage: `7.60 GiB`
- tags:
  `["kasket", "transit", "four", "men", "woman", "standing", "dirt", "path", "front", "mountain", "range", "man", "wearing", "green", "t-shirt", "black", "shorts", "backpack", "trees", "sky"]`
- summary: `null`

_Florence-2-base-ft + Whisper-base.en_

- duration: `0m06s`
- max mem. usage: `2.52 GiB`
- tags:
  `["kasket", "four", "men", "woman", "standing", "dirt", "path", "front", "mountain", "range", "man", "wearing", "green", "t-shirt", "black", "shorts", "backpack", "trees", "sky", "above"]`
- summary: `null`

_Florence-2-base + RapidOCR + Whisper-base.en_

- duration: `0m07s`
- max mem. usage: `8.64 GiB`
- tags:
  `["rasket", "transit", "shows", "group", "five", "people", "standing", "dirt", "trail", "desert-like", "area", "red", "rock", "formations", "all", "smiling", "posing", "photo", "person", "front"]`
- summary: `null`

_Florence-2-large-ft + RapidOCR + Whisper-base.en_

- duration: `0m10s`
- max mem. usage: `9.13 GiB`
- tags:
  `["transit", "four", "people", "standing", "together", "dirt", "all", "wearing", "sunglasses", "trees", "mountain", "red", "rocks"]`
- summary: `null`

_Florence-2-large + RapidOCR + Whisper-base.en_

- duration: `0m14s`
- max mem. usage: `10.32 GiB`
- tags:
  `["transit", "shows", "group", "five", "people", "standing", "dirt", "trail", "desert-like", "landscape", "all", "wearing", "backpacks", "sunglasses", "posing", "photo", "red", "rock", "formations", "clear"]`
- summary: `null`

_Florence-2-base-ft + RapidOCR + Whisper-small.en_

- duration: `0m05s`
- max mem. usage: `8.81 GiB`
- tags:
  `["kasket", "transit", "four", "men", "woman", "standing", "dirt", "path", "front", "mountain", "range", "man", "wearing", "green", "t-shirt", "black", "shorts", "backpack", "trees", "sky"]`
- summary: `null`

### IMG_7212-2.jpg

Description: Image of a black-and-white stage portrait of a young musician giving a thumbs up.

File Metadata: File Size: 0.31 MiB, Duration: n/a, Content Type: `image/jpeg`

_Xenova JS Baseline_

- duration: `0m02s`
- max mem. usage: `2.44 GiB`
- tags: `["man", "white", "object", "his", "hand"]`
- summary: `null`

_Florence-2-base-ft + RapidOCR + Whisper-base.en_

- duration: `0m05s`
- max mem. usage: `7.60 GiB`
- tags:
  `["young", "man", "giving", "thumbs", "wearing", "jean", "jacket", "white", "t-shirt", "design", "hair", "short", "serious", "look", "face", "bright", "light", "him"]`
- summary: `null`

_Florence-2-base-ft + Whisper-base.en_

- duration: `0m05s`
- max mem. usage: `2.52 GiB`
- tags:
  `["young", "man", "giving", "thumbs", "wearing", "jean", "jacket", "white", "t-shirt", "design", "hair", "short", "serious", "look", "face", "bright", "light", "him"]`
- summary: `null`

_Florence-2-base + RapidOCR + Whisper-base.en_

- duration: `0m06s`
- max mem. usage: `8.64 GiB`
- tags:
  `["black", "white", "photograph", "young", "man", "stage", "wearing", "denim", "jacket", "t-shirt", "graphic", "design", "short", "messy", "hair", "looking", "off", "serious", "expression", "face"]`
- summary: `null`

_Florence-2-large-ft + RapidOCR + Whisper-base.en_

- duration: `0m12s`
- max mem. usage: `9.13 GiB`
- tags:
  `["17", "young", "man", "giving", "thumbs", "wearing", "white", "t-shirt", "design", "denim", "jacket", "hair", "cut", "short", "serious", "look", "face"]`
- summary: `null`

_Florence-2-large + RapidOCR + Whisper-base.en_

- duration: `0m14s`
- max mem. usage: `10.32 GiB`
- tags:
  `["black", "white", "portrait", "young", "man", "stage", "wearing", "denim", "jacket", "t-shirt", "graphic", "design", "short", "messy", "hair", "looking", "off", "serious", "expression", "face"]`
- summary: `null`

_Florence-2-base-ft + RapidOCR + Whisper-small.en_

- duration: `0m05s`
- max mem. usage: `8.81 GiB`
- tags:
  `["young", "man", "giving", "thumbs", "wearing", "jean", "jacket", "white", "t-shirt", "design", "hair", "short", "serious", "look", "face", "bright", "light", "him"]`
- summary: `null`

### PXL_20260214_030737769.mp4

Description: Video of a colorful video game character standing in a futuristic room.

File Metadata: File Size: 17.3 MiB, Duration: 0m07s, Content Type: `video/mp4`

_Xenova JS Baseline_

- duration: `0m05s`
- max mem. usage: `2.88 GiB`
- tags:
  `["flower", "arrangement", "displayed", "street", "woman", "stuffed", "animal", "ledge", "pause"]`
- summary: `"[ Pause ]"`

_Florence-2-base-ft + RapidOCR + Whisper-base.en_

- duration: `0m14s`
- max mem. usage: `7.60 GiB`
- tags:
  `["galacta bot275 / 2105", "galai", "galacta bot", "275/275", "galact.boyultimate change275.275", "ultimate charge", "video", "game", "blue", "floor", "walls", "dark", "stairs", "person", "standing", "room", "wearing", "costume", "colorful", "made"]`
- summary: `null`

_Florence-2-base-ft + Whisper-base.en_

- duration: `0m14s`
- max mem. usage: `2.58 GiB`
- tags:
  `["galacta bot275 / 2105", "galact.boyultimate change275.275", "video", "game", "blue", "floor", "walls", "dark", "stairs", "person", "standing", "room", "wearing", "costume", "colorful", "made", "metal", "numbers", "screen", "white"]`
- summary: `null`

_Florence-2-base + RapidOCR + Whisper-base.en_

- duration: `0m19s`
- max mem. usage: `8.64 GiB`
- tags:
  `["galactecalactabot275 / 2/5", "galai", "galacta bot", "275/275", "galact.boyultimate change275/275", "ultimate charge", "screenshot", "video", "game", "fortnite", "shows", "character", "futuristic", "setting", "blue", "floor", "large", "screen", "wearing", "purple"]`
- summary: `null`

_Florence-2-large-ft + RapidOCR + Whisper-base.en_

- duration: `0m25s`
- max mem. usage: `9.13 GiB`
- tags:
  `["galacticagalacta bot275 / 2/75", "galai", "galacta bot", "275/275", "galactia botultimate change275/275", "ultimate charge", "character", "standing", "video", "game", "wearing", "colorful", "outfit", "two", "doors", "stair", "case", "door", "being", "played"]`
- summary: `null`

_Florence-2-large + RapidOCR + Whisper-base.en_

- duration: `0m34s`
- max mem. usage: `10.32 GiB`
- tags:
  `["screenshot", "video", "game", "fortnite", "shows", "character", "wearing", "blue", "orange", "outfit", "large", "headdress", "holding", "sword", "standing", "futuristic-looking", "room", "floor", "purple", "wall"]`
- summary: `null`

_Florence-2-base-ft + RapidOCR + Whisper-small.en_

- duration: `0m14s`
- max mem. usage: `8.81 GiB`
- tags:
  `["galacta bot275 / 2105", "galai", "galacta bot", "275/275", "galact.boyultimate change275.275", "ultimate charge", "video", "game", "blue", "floor", "walls", "dark", "stairs", "person", "standing", "room", "wearing", "costume", "colorful", "made"]`
- summary: `null`

### PXL_20260321_140600157.mp4

Description: Video of an animal swimming underwater in an aquarium enclosure.

File Metadata: File Size: 8.67 MiB, Duration: 0m03s, Content Type: `video/mp4`

_Xenova JS Baseline_

- duration: `0m05s`
- max mem. usage: `2.41 GiB`
- tags:
  `["bird", "flying", "over", "body", "water", "polar", "bear", "swimming", "pool", "fascinated", "i'm", "just", "like", "solid", "than", "they're", "very"]`
- summary: `"I'm just so fascinated by, like, they're very solid."`

_Florence-2-base-ft + RapidOCR + Whisper-base.en_

- duration: `0m11s`
- max mem. usage: `7.60 GiB`
- tags:
  `["٠٠", "٢٠٠", "dolphin", "swimming", "water", "clear", "blue", "brown", "rock", "wall", "fish", "animal", "small", "waves", "air", "fascinated", "i'm", "just", "like", "they're"]`
- summary: `"I'm just so fascinated by like they're very"`

_Florence-2-base-ft + Whisper-base.en_

- duration: `0m11s`
- max mem. usage: `2.61 GiB`
- tags:
  `["٠٠", "٢٠٠", "dolphin", "swimming", "water", "clear", "blue", "brown", "rock", "wall", "fish", "animal", "small", "waves", "air", "fascinated", "i'm", "just", "like", "they're"]`
- summary: `"I'm just so fascinated by like they're very"`

_Florence-2-base + RapidOCR + Whisper-base.en_

- duration: `0m15s`
- max mem. usage: `8.64 GiB`
- tags:
  `["shows", "sea", "lion", "swimming", "aquarium", "center", "body", "partially", "submerged", "water", "head", "turned", "towards", "frame", "mouth", "open", "about", "take", "bite", "droplets"]`
- summary: `"I'm just so fascinated by like they're very"`

_Florence-2-large-ft + RapidOCR + Whisper-base.en_

- duration: `0m22s`
- max mem. usage: `9.13 GiB`
- tags:
  `["seal", "swimming", "water", "small", "rocks", "under", "rock", "wall", "next", "branches", "clear", "blue", "fascinated", "i'm", "just", "like", "they're", "very"]`
- summary: `"I'm just so fascinated by like they're very"`

_Florence-2-large + RapidOCR + Whisper-base.en_

- duration: `0m32s`
- max mem. usage: `10.32 GiB`
- tags:
  `["shows", "sea", "lion", "swimming", "aquarium", "center", "head", "above", "water", "body", "partially", "submerged", "tilted", "upwards", "mouth", "open", "about", "take", "bite", "something"]`
- summary: `"I'm just so fascinated by like they're very"`

_Florence-2-base-ft + RapidOCR + Whisper-small.en_

- duration: `0m12s`
- max mem. usage: `8.81 GiB`
- tags:
  `["٠٠", "٢٠٠", "dolphin", "swimming", "water", "clear", "blue", "brown", "rock", "wall", "fish", "animal", "small", "waves", "air", "like", "fascinated", "i'm", "just", "they're"]`
- summary: `"You're like, I'm just so fascinated by like, they're very"`

### PXL_20260326_132234127~2.mp4

Description: Video of a sunset over distant mountains and clouds.

File Metadata: File Size: 9.58 MiB, Duration: 0m09s, Content Type: `video/mp4`

_Xenova JS Baseline_

- duration: `0m04s`
- max mem. usage: `3.27 GiB`
- tags: `["sunset", "clear", "blue", "sky", "mountain"]`
- summary: `"you"`

_Florence-2-base-ft + RapidOCR + Whisper-base.en_

- duration: `0m12s`
- max mem. usage: `7.60 GiB`
- tags:
  `["sun", "setting", "sky", "partly", "cloudy", "bright", "yellow", "mountains", "distance", "covered", "fog", "clouds", "white", "fluffy"]`
- summary: `null`

_Florence-2-base-ft + Whisper-base.en_

- duration: `0m12s`
- max mem. usage: `2.61 GiB`
- tags:
  `["sun", "setting", "sky", "partly", "cloudy", "bright", "yellow", "mountains", "distance", "covered", "fog", "clouds", "white", "fluffy"]`
- summary: `null`

_Florence-2-base + RapidOCR + Whisper-base.en_

- duration: `0m15s`
- max mem. usage: `8.64 GiB`
- tags:
  `["photograph", "beautiful", "sunset", "mountain", "range", "sky", "warm", "orange", "color", "few", "wispy", "clouds", "scattered", "across", "sun", "partially", "visible", "bright", "glow", "radiating"]`
- summary: `null`

_Florence-2-large-ft + RapidOCR + Whisper-base.en_

- duration: `0m24s`
- max mem. usage: `9.13 GiB`
- tags:
  `["sun", "setting", "mountains", "sky", "orange", "yellow", "some", "clouds", "bright", "covered", "fog", "mostly", "cloudy"]`
- summary: `null`

_Florence-2-large + RapidOCR + Whisper-base.en_

- duration: `0m30s`
- max mem. usage: `10.32 GiB`
- tags:
  `["photograph", "beautiful", "sunset", "mountain", "range", "sky", "warm", "orange", "color", "few", "wispy", "clouds", "scattered", "across", "sun", "partially", "visible", "bright", "glow", "radiating"]`
- summary: `null`

_Florence-2-base-ft + RapidOCR + Whisper-small.en_

- duration: `0m12s`
- max mem. usage: `8.81 GiB`
- tags:
  `["sun", "setting", "sky", "partly", "cloudy", "bright", "yellow", "mountains", "distance", "covered", "fog", "clouds", "white", "fluffy"]`
- summary: `null`

### PXL_20260425_024503603.mp4

Description: Video of a band performing on a small dark stage.

File Metadata: File Size: 16.5 MiB, Duration: 0m07s, Content Type: `video/mp4`

_Xenova JS Baseline_

- duration: `0m05s`
- max mem. usage: `2.64 GiB`
- tags: `["man", "playing", "guitar", "room", "stage", "discount", "music", "total"]`
- summary: `"[Music]"`

_Florence-2-base-ft + RapidOCR + Whisper-base.en_

- duration: `0m12s`
- max mem. usage: `7.60 GiB`
- tags:
  `["people", "playing", "music", "stage", "large", "screen", "wall", "lights", "hanging", "ceiling", "above", "band", "performing", "dark", "man", "black", "jacket", "guitar", "another", "sitting"]`
- summary: `null`

_Florence-2-base-ft + Whisper-base.en_

- duration: `0m12s`
- max mem. usage: `2.61 GiB`
- tags:
  `["people", "playing", "music", "stage", "large", "screen", "wall", "lights", "hanging", "ceiling", "above", "band", "performing", "dark", "man", "black", "jacket", "guitar", "another", "sitting"]`
- summary: `null`

_Florence-2-base + RapidOCR + Whisper-base.en_

- duration: `0m14s`
- max mem. usage: `8.64 GiB`
- tags:
  `["rocky", "bosch", "shows", "band", "performing", "stage", "dimly", "lit", "room", "members", "playing", "various", "instruments", "including", "guitars", "drums", "keyboards", "covered", "blue", "curtain"]`
- summary: `null`

_Florence-2-large-ft + RapidOCR + Whisper-base.en_

- duration: `0m24s`
- max mem. usage: `9.13 GiB`
- tags:
  `["now", "bow", "band", "performing", "stage", "three", "men", "one", "man", "playing", "white", "guitar", "two", "drums", "dark", "lights", "hanging", "ceiling", "four", "guitars"]`
- summary: `null`

_Florence-2-large + RapidOCR + Whisper-base.en_

- duration: `0m31s`
- max mem. usage: `10.32 GiB`
- tags:
  `["now", "north", "shows", "band", "performing", "stage", "dimly", "lit", "room", "three", "musicians", "two", "playing", "guitars", "one", "drums", "members", "dressed", "casual", "clothes"]`
- summary: `null`

_Florence-2-base-ft + RapidOCR + Whisper-small.en_

- duration: `0m12s`
- max mem. usage: `8.81 GiB`
- tags:
  `["people", "playing", "music", "stage", "large", "screen", "wall", "lights", "hanging", "ceiling", "above", "band", "performing", "dark", "man", "black", "jacket", "guitar", "another", "sitting"]`
- summary: `null`

### Screen Recording 2026-05-15 at 10.15.22 AM.mov

Description: Screen recording of an Alpine product discussion page with comments and a post about
the Design System V2 documentation site.

File Metadata: File Size: 1.93 MiB, Duration: 0m08s, Content Type: `video/quicktime`

_Xenova JS Baseline_

- duration: `0m04s`
- max mem. usage: `2.67 GiB`
- tags:
  `["web site", "web", "site", "website", "internet site", "internet", "white", "blue", "striped", "colored", "paper", "wall"]`
- summary: `null`

_Florence-2-base-ft + RapidOCR + Whisper-base.en_

- duration: `0m27s`
- max mem. usage: `7.60 GiB`
- tags:
  `["screenshot", "webpage", "titled", "product", "white", "top", "number", "description", "paragraph", "about", "direction", "design", "reviews", "feature", "discussions", "bottom", "does", "use", "list", "comments"]`
- summary: `null`

_Florence-2-base-ft + Whisper-base.en_

- duration: `0m27s`
- max mem. usage: `2.64 GiB`
- tags:
  `["screenshot", "webpage", "titled", "product", "white", "top", "number", "description", "paragraph", "about", "direction", "design", "reviews", "feature", "discussions", "bottom", "does", "use", "list", "comments"]`
- summary: `null`

_Florence-2-base + RapidOCR + Whisper-base.en_

- duration: `0m29s`
- max mem. usage: `8.64 GiB`
- tags:
  `["screenshot", "product", "website", "divided", "two", "sections", "top", "section", "titled", "list", "comments", "button", "add", "comment", "tabs", "commenter", "about", "direction", "design", "reviews"]`
- summary: `null`

_Florence-2-large-ft + RapidOCR + Whisper-base.en_

- duration: `0m59s`
- max mem. usage: `9.13 GiB`
- tags:
  `["screenshot", "website", "titled", "product", "heading", "comment", "commenter", "top", "list", "comments", "description", "content", "states", "design", "system", "v2", "documentation", "site", "live", "every"]`
- summary: `null`

_Florence-2-large + RapidOCR + Whisper-base.en_

- duration: `1m14s`
- max mem. usage: `10.32 GiB`
- tags:
  `["screenshot", "product", "website", "titled", "list", "comments", "user", "named", "comment", "commenter", "top", "dropdown", "menu", "options", "such", "add", "test", "hello", "script", "design"]`
- summary: `null`

_Florence-2-base-ft + RapidOCR + Whisper-small.en_

- duration: `0m28s`
- max mem. usage: `8.81 GiB`
- tags:
  `["screenshot", "webpage", "titled", "product", "white", "top", "number", "description", "paragraph", "about", "direction", "design", "reviews", "feature", "discussions", "bottom", "does", "use", "list", "comments"]`
- summary: `null`

### Screen Recording 2026-05-15 at 10.15.40 AM.mov

Description: Screen recording of an Alpine product discussion page with comments and design system
documentation text.

File Metadata: File Size: 1.60 MiB, Duration: 0m08s, Content Type: `video/quicktime`

_Xenova JS Baseline_

- duration: `0m04s`
- max mem. usage: `2.72 GiB`
- tags: `["web site", "web", "site", "website", "internet site", "internet"]`
- summary: `null`

_Florence-2-base-ft + RapidOCR + Whisper-base.en_

- duration: `0m27s`
- max mem. usage: `7.60 GiB`
- tags:
  `["screenshot", "webpage", "titled", "product", "white", "text", "design", "system", "v2", "documentation", "site", "live", "every", "component", "now", "description", "does", "use", "purpose", "ap"]`
- summary: `null`

_Florence-2-base-ft + Whisper-base.en_

- duration: `0m27s`
- max mem. usage: `2.66 GiB`
- tags:
  `["screenshot", "webpage", "titled", "product", "white", "text", "design", "system", "v2", "documentation", "site", "live", "every", "component", "now", "description", "does", "use", "purpose", "ap"]`
- summary: `null`

_Florence-2-base + RapidOCR + Whisper-base.en_

- duration: `0m28s`
- max mem. usage: `8.64 GiB`
- tags:
  `["screenshot", "product", "software", "application", "titled", "list", "comments", "user", "arranged", "grid-like", "format", "each", "comment", "having", "title", "brief", "description", "top", "search", "bar"]`
- summary: `null`

_Florence-2-large-ft + RapidOCR + Whisper-base.en_

- duration: `1m03s`
- max mem. usage: `9.13 GiB`
- tags:
  `["screenshot", "computer", "screen", "window", "open", "titled", "product", "list", "five", "bullet", "points", "first", "point", "comment", "test", "user", "second", "third", "add", "under"]`
- summary: `null`

_Florence-2-large + RapidOCR + Whisper-base.en_

- duration: `1m07s`
- max mem. usage: `10.32 GiB`
- tags:
  `["screenshot", "product", "website", "titled", "list", "comments", "user", "black", "text", "white", "top", "menu", "bar", "options", "such", "about", "direction", "design", "reviews", "feature"]`
- summary: `null`

_Florence-2-base-ft + RapidOCR + Whisper-small.en_

- duration: `0m26s`
- max mem. usage: `8.81 GiB`
- tags:
  `["screenshot", "webpage", "titled", "product", "white", "text", "design", "system", "v2", "documentation", "site", "live", "every", "component", "now", "description", "does", "use", "purpose", "ap"]`
- summary: `null`

### YTDown_YouTube_Animate-Fish-in-Blender-Lazy-Tutorials_Media_58lc8sLpJzY_002_720p.mp4

Description: Video of a Blender tutorial showing a fish model and node settings used to animate it
swimming.

File Metadata: File Size: 1.90 MiB, Duration: 1m00s, Content Type: `video/mp4`

_Xenova JS Baseline_

- duration: `0m08s`
- max mem. usage: `3.28 GiB`
- tags:
  `["korean", "black", "white", "computer", "keyboard", "him", "texture", "fish", "little", "make", "duplicate", "image", "just", "modifier", "scale", "swoosh's", "big", "bit", "cloud", "coordinates"]`
- summary: `"No, add a texture. In the texture editor, make little swoosh's a cloud texture."`

_Florence-2-base-ft + RapidOCR + Whisper-base.en_

- duration: `0m08s`
- max mem. usage: `3.40 GiB`
- tags:
  `["korean", "black", "white", "computer", "keyboard", "him", "texture", "fish", "little", "make", "duplicate", "image", "just", "modifier", "scale", "swoosh's", "big", "bit", "cloud", "coordinates"]`
- summary: `"No, add a texture. In the texture editor, make little swoosh's a cloud texture."`

_Florence-2-base-ft + Whisper-base.en_

- duration: `0m22s`
- max mem. usage: `2.33 GiB`
- tags:
  `["picture", "fish", "computer", "screen", "black", "next", "many", "icons", "screenshot", "white", "say", "type", "clouds", "list", "different", "colors", "first", "row", "word", "second"]`
- summary: `"Displacement modifier. In the texture editor, make little swoosh's a cloud texture."`

_Florence-2-base + RapidOCR + Whisper-base.en_

- duration: `0m26s`
- max mem. usage: `2.44 GiB`
- tags:
  `["screenshot", "3d", "modeling", "software", "interface", "panel", "various", "options", "settings", "black", "grid-like", "pattern", "top", "several", "buttons", "menus", "corner", "screen", "menu", "bar"]`
- summary: `"Displacement modifier. In the texture editor, make little swoosh's a cloud texture."`

_Florence-2-large-ft + RapidOCR + Whisper-base.en_

- duration: `0m45s`
- max mem. usage: `5.26 GiB`
- tags:
  `["black", "white", "text", "boxes", "fish", "blue", "orange", "yellow", "color", "small", "star", "screenshot", "program", "circle", "top", "corner", "rectangle", "big", "swooshies", "several"]`
- summary: `"Displacement modifier. In the texture editor, make little swoosh's a cloud texture."`

_Florence-2-large + RapidOCR + Whisper-base.en_

- duration: `0m55s`
- max mem. usage: `5.57 GiB`
- tags:
  `["screenshot", "3d", "modeling", "software", "interface", "panel", "various", "tools", "options", "creating", "editing", "models", "divided", "two", "sections", "panels", "top", "menu", "bar", "such"]`
- summary: `"Displacement modifier. In the texture editor, make little swoosh's a cloud texture."`

_Florence-2-base-ft + RapidOCR + Whisper-small.en_

- duration: `0m24s`
- max mem. usage: `2.54 GiB`
- tags:
  `["picture", "fish", "computer", "screen", "black", "next", "many", "icons", "screenshot", "white", "say", "type", "clouds", "list", "different", "colors", "first", "row", "word", "second"]`
- summary: `"Duplicate Mr. Duplicate, scale, duplicate."`

### YTDown_YouTube_Animate-Fish-in-Blender-Lazy-Tutorials_Media_58lc8sLpJzY_007_128k.mp3

Description: Audio from a Blender tutorial about modeling and animating a swimming fish.

File Metadata: File Size: 1.01 MiB, Duration: 1m00s, Content Type: `audio/mpeg`

_Xenova JS Baseline_

- duration: `0m05s`
- max mem. usage: `1.28 GiB`
- tags:
  `["him", "texture", "fish", "little", "make", "duplicate", "image", "just", "modifier", "scale", "swoosh's", "big", "bit", "cloud", "coordinates", "direction", "displacement", "editor", "global", "gotta"]`
- summary: `"No, add a texture. In the texture editor, make little swoosh's a cloud texture."`

_Florence-2-base-ft + RapidOCR + Whisper-base.en_

- duration: `0m05s`
- max mem. usage: `1.24 GiB`
- tags:
  `["him", "texture", "fish", "little", "make", "duplicate", "image", "just", "modifier", "scale", "swoosh's", "big", "bit", "cloud", "coordinates", "direction", "displacement", "editor", "global", "gotta"]`
- summary: `"No, add a texture. In the texture editor, make little swoosh's a cloud texture."`

_Florence-2-base-ft + Whisper-base.en_

- duration: `0m03s`
- max mem. usage: `575 MiB`
- tags:
  `["him", "texture", "fish", "little", "make", "displacement", "duplicate", "image", "just", "modifier", "scale", "swoosh's", "big", "bit", "cloud", "coordinates", "direction", "editor", "global", "gotta"]`
- summary: `"Displacement modifier. In the texture editor, make little swoosh's a cloud texture."`

_Florence-2-base + RapidOCR + Whisper-base.en_

- duration: `0m03s`
- max mem. usage: `580 MiB`
- tags:
  `["him", "texture", "fish", "little", "make", "displacement", "duplicate", "image", "just", "modifier", "scale", "swoosh's", "big", "bit", "cloud", "coordinates", "direction", "editor", "global", "gotta"]`
- summary: `"Displacement modifier. In the texture editor, make little swoosh's a cloud texture."`

_Florence-2-large-ft + RapidOCR + Whisper-base.en_

- duration: `0m03s`
- max mem. usage: `568 MiB`
- tags:
  `["him", "texture", "fish", "little", "make", "displacement", "duplicate", "image", "just", "modifier", "scale", "swoosh's", "big", "bit", "cloud", "coordinates", "direction", "editor", "global", "gotta"]`
- summary: `"Displacement modifier. In the texture editor, make little swoosh's a cloud texture."`

_Florence-2-large + RapidOCR + Whisper-base.en_

- duration: `0m03s`
- max mem. usage: `580 MiB`
- tags:
  `["him", "texture", "fish", "little", "make", "displacement", "duplicate", "image", "just", "modifier", "scale", "swoosh's", "big", "bit", "cloud", "coordinates", "direction", "editor", "global", "gotta"]`
- summary: `"Displacement modifier. In the texture editor, make little swoosh's a cloud texture."`

_Florence-2-base-ft + RapidOCR + Whisper-small.en_

- duration: `0m04s`
- max mem. usage: `573 MiB`
- tags:
  `["fish", "duplicate", "him", "image", "just", "make", "texture", "big", "coordinates", "direction", "displacement", "global", "gotta", "it's", "let's", "little", "model", "modifier", "now", "ol'"]`
- summary: `"Alright, model some sort of fish. Duplicate Mr."`

### YTDown_YouTube_Nobody-Ever-Buys-Salt_Media_XHsmaxrvsw0_002_720p.mp4

Description: Video of a salt commercial with a salt canister on a shelf and a person pouring salt.

File Metadata: File Size: 3.43 MiB, Duration: 0m30s, Content Type: `video/mp4`

_Xenova JS Baseline_

- duration: `0m05s`
- max mem. usage: `2.60 GiB`
- tags:
  `["cup", "coffee", "shelf", "man", "white", "object", "his", "hand", "how", "i've", "salt", "abandoned", "always", "assault", "bad", "bought", "buys", "clue", "crappy", "default"]`
- summary:
  `"Nobody ever buys salt It's always just there by default How does it get there? No clue I've never bought it, have you?"`

_Florence-2-base-ft + RapidOCR + Whisper-base.en_

- duration: `0m13s`
- max mem. usage: `2.57 GiB`
- tags:
  `["greatvaluesalt", "salt", "can", "sits", "wooden", "shelf", "blue", "white", "silver", "spoon", "brown", "wall", "dark", "man", "looking", "camera", "holding", "small", "bottle", "hand"]`
- summary: `"Nobody ever buys salt. How does it get there?"`

_Florence-2-base-ft + Whisper-base.en_

- duration: `0m13s`
- max mem. usage: `2.22 GiB`
- tags:
  `["greatvaluesalt", "can", "salt", "sits", "wooden", "shelf", "blue", "white", "silver", "spoon", "brown", "wall", "dark", "man", "looking", "camera", "holding", "small", "bottle", "hand"]`
- summary: `"Nobody ever buys salt. How does it get there?"`

_Florence-2-base + RapidOCR + Whisper-base.en_

- duration: `0m17s`
- max mem. usage: `2.34 GiB`
- tags:
  `["greatvaluesalt", "salt", "shows", "can", "great", "value", "wooden", "shelf", "blue", "white", "color", "brand", "name", "front", "label", "also", "two", "shakers", "blurred", "but"]`
- summary: `"Nobody ever buys salt. How does it get there?"`

_Florence-2-large-ft + RapidOCR + Whisper-base.en_

- duration: `0m28s`
- max mem. usage: `5.23 GiB`
- tags:
  `["greatvaluesalt", "salt", "٠٠", "can", "sitting", "wooden", "shelf", "blue", "white", "man", "looking", "something", "air", "holding", "small", "tan", "container", "hand", "smoke", "coming"]`
- summary: `"Nobody ever buys salt. How does it get there?"`

_Florence-2-large + RapidOCR + Whisper-base.en_

- duration: `0m34s`
- max mem. usage: `5.10 GiB`
- tags:
  `["great", "value", "salt", "shows", "can", "wooden", "shelf", "blue", "white", "color", "brand", "name", "top", "label", "also", "shaker", "spoon", "dark", "made", "wood"]`
- summary: `"Nobody ever buys salt. How does it get there?"`

_Florence-2-base-ft + RapidOCR + Whisper-small.en_

- duration: `0m21s`
- max mem. usage: `2.66 GiB`
- tags:
  `["greatvaluesalt", "salt", "can", "sits", "wooden", "shelf", "blue", "white", "silver", "spoon", "brown", "wall", "dark", "man", "looking", "camera", "holding", "small", "bottle", "hand"]`
- summary:
  `"Nobody ever buys salt It's always just there by default How does it get there? No clue I've never bought it, have you?"`

### YTDown_YouTube_Nobody-Ever-Buys-Salt_Media_XHsmaxrvsw0_007_128k.mp3

Description: Audio of a comedic spoken-word ad about how nobody ever buys salt.

File Metadata: File Size: 0.55 MiB, Duration: 0m30s, Content Type: `audio/mpeg`

_Xenova JS Baseline_

- duration: `0m02s`
- max mem. usage: `1.37 GiB`
- tags:
  `["how", "i've", "salt", "abandoned", "always", "assault", "bad", "bought", "buys", "clue", "crappy", "default", "ditched", "does", "ever", "get", "had", "it's", "just", "know"]`
- summary:
  `"Nobody ever buys salt It's always just there by default How does it get there? No clue I've never bought it, have you?"`

_Florence-2-base-ft + RapidOCR + Whisper-base.en_

- duration: `0m02s`
- max mem. usage: `1.33 GiB`
- tags:
  `["how", "i've", "salt", "abandoned", "always", "assault", "bad", "bought", "buys", "clue", "crappy", "default", "ditched", "does", "ever", "get", "had", "it's", "just", "know"]`
- summary:
  `"Nobody ever buys salt It's always just there by default How does it get there? No clue I've never bought it, have you?"`

_Florence-2-base-ft + Whisper-base.en_

- duration: `0m01s`
- max mem. usage: `548 MiB`
- tags:
  `["how", "i've", "salt", "abandoned", "always", "assault", "bad", "bought", "but", "buys", "clue", "crappy", "default", "ditched", "does", "ever", "get", "had", "it's", "just"]`
- summary: `"Nobody ever buys salt. How does it get there?"`

_Florence-2-base + RapidOCR + Whisper-base.en_

- duration: `0m01s`
- max mem. usage: `566 MiB`
- tags:
  `["how", "i've", "salt", "abandoned", "always", "assault", "bad", "bought", "but", "buys", "clue", "crappy", "default", "ditched", "does", "ever", "get", "had", "it's", "just"]`
- summary: `"Nobody ever buys salt. How does it get there?"`

_Florence-2-large-ft + RapidOCR + Whisper-base.en_

- duration: `0m01s`
- max mem. usage: `537 MiB`
- tags:
  `["how", "i've", "salt", "abandoned", "always", "assault", "bad", "bought", "but", "buys", "clue", "crappy", "default", "ditched", "does", "ever", "get", "had", "it's", "just"]`
- summary: `"Nobody ever buys salt. How does it get there?"`

_Florence-2-large + RapidOCR + Whisper-base.en_

- duration: `0m01s`
- max mem. usage: `542 MiB`
- tags:
  `["how", "i've", "salt", "abandoned", "always", "assault", "bad", "bought", "but", "buys", "clue", "crappy", "default", "ditched", "does", "ever", "get", "had", "it's", "just"]`
- summary: `"Nobody ever buys salt. How does it get there?"`

_Florence-2-base-ft + RapidOCR + Whisper-small.en_

- duration: `0m02s`
- max mem. usage: `563 MiB`
- tags:
  `["how", "i've", "salt", "abandoned", "always", "assault", "bad", "bought", "but", "buys", "clue", "crappy", "default", "ditched", "does", "ever", "get", "had", "it's", "just"]`
- summary:
  `"Nobody ever buys salt It's always just there by default How does it get there? No clue I've never bought it, have you?"`

### YTDown_YouTube_Taco-Bell-Commercial-2025-USA-5-7-and-9-\_Media_BpXG8kWDZ1E_002_720p.mp4

Description: Video of a Taco Bell commercial with burritos, drinks, and promotional offer text.

File Metadata: File Size: 4.22 MiB, Duration: 0m15s, Content Type: `video/mp4`

_Xenova JS Baseline_

- duration: `0m06s`
- max mem. usage: `2.27 GiB`
- tags:
  `["table", "topped", "sandwich", "drink", "person", "slice", "cake", "paper", "box", "lux", "bell", "boxes", "cravings", "taco", "9th", "burrito", "cheese", "classic", "discount", "eat"]`
- summary:
  `"Eat Lux your way with the Lux Cravings Boxes from Taco Bell. This is the classic $5 box."`

_Florence-2-base-ft + RapidOCR + Whisper-base.en_

- duration: `0m05s`
- max mem. usage: `3.28 GiB`
- tags:
  `["table", "topped", "sandwich", "drink", "person", "slice", "cake", "paper", "box", "lux", "bell", "boxes", "cravings", "taco", "9th", "burrito", "cheese", "classic", "discount", "eat"]`
- summary:
  `"Eat Lux your way with the Lux Cravings Boxes from Taco Bell. This is the classic $5 box."`

_Florence-2-base-ft + Whisper-base.en_

- duration: `0m20s`
- max mem. usage: `2.13 GiB`
- tags:
  `["advertisement", "fast", "food", "restaurant", "called", "luxe", "cravings", "boxes", "stacked", "top", "each", "wooden", "sandwiches", "three", "plastic", "cups", "straws", "hand", "holding", "grilled"]`
- summary:
  `"Eat Luxe Your Way with the Luxe Craving Boxes from Taco Bell. This is the classic $5 box."`

_Florence-2-base + RapidOCR + Whisper-base.en_

- duration: `0m24s`
- max mem. usage: `2.43 GiB`
- tags:
  `["flamin'hot", "grilledcheeseburrito", "shows", "variety", "luxury", "cravings", "boxes", "taco", "bell", "arranged", "pyramid-like", "shape", "stacked", "top", "each", "box", "different", "type", "inside", "including"]`
- summary:
  `"Eat Luxe Your Way with the Luxe Craving Boxes from Taco Bell. This is the classic $5 box."`

_Florence-2-large-ft + RapidOCR + Whisper-base.en_

- duration: `0m35s`
- max mem. usage: `5.18 GiB`
- tags:
  `["flamin'hot", "grilledcheeseburrito", "several", "boxes", "food", "two", "cups", "straws", "next", "yellow", "top", "hand", "holding", "grilled", "cheese", "burrito", "fire", "person", "wearing", "white"]`
- summary:
  `"Eat Luxe Your Way with the Luxe Craving Boxes from Taco Bell. This is the classic $5 box."`

_Florence-2-large + RapidOCR + Whisper-base.en_

- duration: `0m36s`
- max mem. usage: `5.45 GiB`
- tags:
  `["shows", "several", "boxes", "luxe", "cravings", "stacked", "top", "each", "filled", "different", "types", "food", "items", "such", "tacos", "burritos", "wraps", "also", "two", "cups"]`
- summary:
  `"Eat Luxe Your Way with the Luxe Craving Boxes from Taco Bell. This is the classic $5 box."`

_Florence-2-base-ft + RapidOCR + Whisper-small.en_

- duration: `0m17s`
- max mem. usage: `2.71 GiB`
- tags:
  `["flamin'hot", "grilledcheeseburrito", "advertisement", "fast", "food", "restaurant", "called", "luxe", "cravings", "boxes", "stacked", "top", "each", "wooden", "sandwiches", "three", "plastic", "cups", "straws", "hand"]`
- summary:
  `"Eat Lux Your Way with the Lux Cravings boxes from Taco Bell. Try the Lux Cravings boxes at Taco Bell today."`

### YTDown_YouTube_The-Windows-Update-We-All-Wanted_Media_Kxn62gTEpIU_003_480p.mp4

Description: Video of a tech-news presenter discussing Windows Update while article screenshots
appear on screen.

File Metadata: File Size: 29.7 MiB, Duration: 9m05s, Content Type: `video/mp4`

_Xenova JS Baseline_

- duration: `0m29s`
- max mem. usage: `3.35 GiB`
- tags:
  `["web site", "web", "site", "website", "internet site", "internet", "man", "wii", "remote", "his", "hand", "collage", "photos", "showing", "variety", "food", "it's", "just", "know", "use"]`
- summary: `"It's Bond Me. So it's not just like Instagram."`

_Florence-2-base-ft + RapidOCR + Whisper-base.en_

- duration: `0m29s`
- max mem. usage: `3.25 GiB`
- tags:
  `["web site", "web", "site", "website", "internet site", "internet", "man", "wii", "remote", "his", "hand", "collage", "photos", "showing", "variety", "food", "it's", "just", "know", "use"]`
- summary: `"It's Bond Me. So it's not just like Instagram."`

_Florence-2-base-ft + Whisper-base.en_

- duration: `0m31s`
- max mem. usage: `2.39 GiB`
- tags:
  `["man", "black", "shirt", "standing", "front", "wall", "blue", "yellow", "checkered", "screenshot", "website", "called", "xperia", "green", "border", "around", "top", "picture", "food", "say"]`
- summary: `"I don't know how. I don't know, you guys don't get it."`

_Florence-2-base + RapidOCR + Whisper-base.en_

- duration: `0m36s`
- max mem. usage: `2.77 GiB`
- tags:
  `["shows", "young", "man", "standing", "front", "colorful", "wall", "squares", "different", "colors", "wearing", "black", "t-shirt", "glasses", "beard", "mustache", "giving", "presentation", "speech", "arms"]`
- summary: `"I don't know how. I don't know, you guys don't get it."`

_Florence-2-large-ft + RapidOCR + Whisper-base.en_

- duration: `0m53s`
- max mem. usage: `5.68 GiB`
- tags:
  `["man", "standing", "front", "wall", "wearing", "black", "shirt", "glasses", "blue", "white", "yellow", "squares", "screenshot", "website", "green", "color", "scheme", "top", "heading", "sony's"]`
- summary: `"I don't know how. I don't know, you guys don't get it."`

_Florence-2-large + RapidOCR + Whisper-base.en_

- duration: `1m03s`
- max mem. usage: `5.47 GiB`
- tags:
  `["shows", "young", "man", "standing", "front", "colorful", "wall", "geometric", "pattern", "wearing", "black", "t-shirt", "glasses", "mustache", "room", "blue", "orange", "color", "scheme", "arms"]`
- summary: `"I don't know how. I don't know, you guys don't get it."`

_Florence-2-base-ft + RapidOCR + Whisper-small.en_

- duration: `0m43s`
- max mem. usage: `2.87 GiB`
- tags:
  `["man", "black", "shirt", "standing", "front", "wall", "blue", "yellow", "checkered", "screenshot", "website", "called", "xperia", "green", "border", "around", "top", "picture", "food", "say"]`
- summary: `"You just know what... So it's not just like Instagram."`

### YTDown_YouTube_The-Windows-Update-We-All-Wanted_Media_Kxn62gTEpIU_009_128k.mp3

Description: Audio of a tech-news segment about Windows Update, drivers, GPUs, and other industry
stories.

File Metadata: File Size: 9.93 MiB, Duration: 9m05s, Content Type: `audio/mpeg`

_Xenova JS Baseline_

- duration: `0m24s`
- max mem. usage: `1.67 GiB`
- tags:
  `["it's", "just", "know", "use", "day", "don't", "because", "going", "instagram", "into", "more", "new", "series", "still", "will", "windows", "back", "bad", "bangkok", "bill"]`
- summary: `"It's Bonme! So it's not just like Instagram."`

_Florence-2-base-ft + RapidOCR + Whisper-base.en_

- duration: `0m24s`
- max mem. usage: `1.67 GiB`
- tags:
  `["it's", "just", "know", "use", "day", "don't", "because", "going", "instagram", "into", "more", "new", "series", "still", "will", "windows", "back", "bad", "bangkok", "bill"]`
- summary: `"It's Bonme! So it's not just like Instagram."`

_Florence-2-base-ft + Whisper-base.en_

- duration: `0m13s`
- max mem. usage: `760 MiB`
- tags:
  `["but", "don't", "will", "it's", "now", "just", "know", "windows", "back", "bad", "day", "games", "instagram", "more", "new", "recovery", "samsung", "series", "update", "because"]`
- summary: `"I don't know how. I don't know, you guys don't get it."`

_Florence-2-base + RapidOCR + Whisper-base.en_

- duration: `0m12s`
- max mem. usage: `765 MiB`
- tags:
  `["but", "don't", "will", "it's", "now", "just", "know", "windows", "back", "bad", "day", "games", "instagram", "more", "new", "recovery", "samsung", "series", "update", "because"]`
- summary: `"I don't know how. I don't know, you guys don't get it."`

_Florence-2-large-ft + RapidOCR + Whisper-base.en_

- duration: `0m12s`
- max mem. usage: `775 MiB`
- tags:
  `["but", "don't", "will", "it's", "now", "just", "know", "windows", "back", "bad", "day", "games", "instagram", "more", "new", "recovery", "samsung", "series", "update", "because"]`
- summary: `"I don't know how. I don't know, you guys don't get it."`

_Florence-2-large + RapidOCR + Whisper-base.en_

- duration: `0m13s`
- max mem. usage: `782 MiB`
- tags:
  `["but", "don't", "will", "it's", "now", "just", "know", "windows", "back", "bad", "day", "games", "instagram", "more", "new", "recovery", "samsung", "series", "update", "because"]`
- summary: `"I don't know how. I don't know, you guys don't get it."`

_Florence-2-base-ft + RapidOCR + Whisper-small.en_

- duration: `0m24s`
- max mem. usage: `765 MiB`
- tags:
  `["it's", "but", "just", "will", "don't", "know", "series", "use", "day", "going", "now", "rog", "about", "because", "can", "cards", "games", "instagram", "more", "photos"]`
- summary: `"You just know. So it's not just like Instagram."`

### pexels-cottonbro-6568667.jpg

Description: Image of a man in dark clothing standing against a dark wall while holding papers or a
notebook.

File Metadata: File Size: 1.00 MiB, Duration: n/a, Content Type: `image/jpeg`

_Xenova JS Baseline_

- duration: `0m03s`
- max mem. usage: `2.78 GiB`
- tags: `["man", "laptop", "looking"]`
- summary: `null`

_Florence-2-base-ft + RapidOCR + Whisper-base.en_

- duration: `0m12s`
- max mem. usage: `8.50 GiB`
- tags:
  `["000", "man", "standing", "front", "wall", "wearing", "black", "suit", "white", "shirt", "under", "glasses", "face", "holding", "papers", "hands"]`
- summary: `null`

_Florence-2-base-ft + Whisper-base.en_

- duration: `0m05s`
- max mem. usage: `2.80 GiB`
- tags:
  `["000", "man", "standing", "front", "wall", "wearing", "black", "suit", "white", "shirt", "under", "glasses", "face", "holding", "papers", "hands"]`
- summary: `null`

_Florence-2-base + RapidOCR + Whisper-base.en_

- duration: `0m12s`
- max mem. usage: `10.01 GiB`
- tags:
  `["000", "shows", "man", "standing", "front", "dark", "grey", "wearing", "black", "suit", "glasses", "beard", "holding", "paper", "hand", "looking", "down", "serious", "expression", "face"]`
- summary: `null`

_Florence-2-large-ft + RapidOCR + Whisper-base.en_

- duration: `0m18s`
- max mem. usage: `9.13 GiB`
- tags:
  `["man", "standing", "front", "dark", "gray", "wall", "wearing", "black", "suit", "shirt", "glasses", "holding", "paper", "one", "hand", "envelope", "short", "hair", "beard"]`
- summary: `null`

_Florence-2-large + RapidOCR + Whisper-base.en_

- duration: `0m21s`
- max mem. usage: `10.47 GiB`
- tags:
  `["0000", "shows", "man", "standing", "front", "dark", "grey", "wearing", "black", "suit", "glasses", "beard", "holding", "paper", "hand", "reading", "intently", "slightly", "tilted", "about"]`
- summary: `null`

_Florence-2-base-ft + RapidOCR + Whisper-small.en_

- duration: `0m12s`
- max mem. usage: `8.81 GiB`
- tags:
  `["000", "man", "standing", "front", "wall", "wearing", "black", "suit", "white", "shirt", "under", "glasses", "face", "holding", "papers", "hands"]`
- summary: `null`

### pexels-cottonbro-7505174.jpg

Description: Image of a woman browsing books on shelves in a bright room.

File Metadata: File Size: 1.34 MiB, Duration: n/a, Content Type: `image/jpeg`

_Xenova JS Baseline_

- duration: `0m03s`
- max mem. usage: `2.72 GiB`
- tags: `["woman", "room", "book", "shelf"]`
- summary: `null`

_Florence-2-base-ft + RapidOCR + Whisper-base.en_

- duration: `0m10s`
- max mem. usage: `8.50 GiB`
- tags:
  `["woman", "standing", "room", "wearing", "orange", "shirt", "white", "shelf", "next", "books", "top"]`
- summary: `null`

_Florence-2-base-ft + Whisper-base.en_

- duration: `0m05s`
- max mem. usage: `2.85 GiB`
- tags:
  `["woman", "standing", "room", "wearing", "orange", "shirt", "white", "shelf", "next", "books", "top"]`
- summary: `null`

_Florence-2-base + RapidOCR + Whisper-base.en_

- duration: `0m11s`
- max mem. usage: `10.01 GiB`
- tags:
  `["can", "see", "young", "woman", "standing", "room", "white", "brick", "walls", "wearing", "orange", "t-shirt", "curly", "hair", "looking", "ceiling", "thoughtful", "expression", "face", "bookshelf"]`
- summary: `null`

_Florence-2-large-ft + RapidOCR + Whisper-base.en_

- duration: `0m17s`
- max mem. usage: `10.24 GiB`
- tags:
  `["woman", "orange", "shirt", "standing", "room", "white", "shelves", "wall", "next", "plant", "pot", "floor"]`
- summary: `null`

_Florence-2-large + RapidOCR + Whisper-base.en_

- duration: `0m20s`
- max mem. usage: `11.18 GiB`
- tags:
  `["shows", "young", "woman", "standing", "room", "white", "brick", "wall", "shelves", "wearing", "orange", "jumpsuit", "curly", "dark", "hair", "shelf", "various", "wooden", "planks", "different"]`
- summary: `null`

_Florence-2-base-ft + RapidOCR + Whisper-small.en_

- duration: `0m10s`
- max mem. usage: `8.81 GiB`
- tags:
  `["woman", "standing", "room", "wearing", "orange", "shirt", "white", "shelf", "next", "books", "top"]`
- summary: `null`

### pexels-eva-bronzini-6475529.jpg

Description: Image of an envelope with letter tiles spelling IDEA.

File Metadata: File Size: 1.62 MiB, Duration: n/a, Content Type: `image/jpeg`

_Xenova JS Baseline_

- duration: `0m03s`
- max mem. usage: `2.68 GiB`
- tags: `["envelope", "paper", "black", "surface"]`
- summary: `null`

_Florence-2-base-ft + RapidOCR + Whisper-base.en_

- duration: `0m10s`
- max mem. usage: `8.50 GiB`
- tags:
  `["id,ea", "envelope", "plain", "brown", "rectangular", "shape", "shadow", "black", "foreign", "language", "white", "ea", "id"]`
- summary: `null`

_Florence-2-base-ft + Whisper-base.en_

- duration: `0m07s`
- max mem. usage: `2.85 GiB`
- tags:
  `["id,ea", "envelope", "plain", "brown", "rectangular", "shape", "shadow", "black", "foreign", "language", "white", "ea", "id"]`
- summary: `null`

_Florence-2-base + RapidOCR + Whisper-base.en_

- duration: `0m09s`
- max mem. usage: `10.01 GiB`
- tags:
  `["idea", "photograph", "square-shaped", "brown", "paper", "word", "black", "capital", "slightly", "crumpled", "rough", "texture", "plain", "grey", "surface", "overall", "mood", "simple", "minimalistic"]`
- summary: `null`

_Florence-2-large-ft + RapidOCR + Whisper-base.en_

- duration: `0m17s`
- max mem. usage: `10.24 GiB`
- tags:
  `["idea", "envelope", "square", "made", "cardboard", "light", "brown", "color", "stamp", "capital", "black", "plain", "white", "surface", "shadow", "cast"]`
- summary: `null`

_Florence-2-large + RapidOCR + Whisper-base.en_

- duration: `0m16s`
- max mem. usage: `11.18 GiB`
- tags:
  `["idea", "close-up", "square-shaped", "brown", "paper", "word", "black", "capital", "slightly", "crumpled", "rough", "texture", "light", "grey", "color", "shadow"]`
- summary: `null`

_Florence-2-base-ft + RapidOCR + Whisper-small.en_

- duration: `0m10s`
- max mem. usage: `8.81 GiB`
- tags:
  `["id,ea", "envelope", "plain", "brown", "rectangular", "shape", "shadow", "black", "foreign", "language", "white", "ea", "id"]`
- summary: `null`

### pexels-eva-bronzini-6956318.jpg

Description: Image of a black ribbon or wristband with the word STARTUP on a beige surface.

File Metadata: File Size: 0.87 MiB, Duration: n/a, Content Type: `image/jpeg`

_Xenova JS Baseline_

- duration: `0m03s`
- max mem. usage: `2.77 GiB`
- tags: `["white", "black", "tie", "hanging", "wall"]`
- summary: `null`

_Florence-2-base-ft + RapidOCR + Whisper-base.en_

- duration: `0m10s`
- max mem. usage: `8.50 GiB`
- tags: `["startup", "rtup", "black", "wristband", "laying", "beige", "carpet", "shadow", "cast"]`
- summary: `null`

_Florence-2-base-ft + Whisper-base.en_

- duration: `0m05s`
- max mem. usage: `2.86 GiB`
- tags: `["startup", "black", "wristband", "laying", "beige", "carpet", "shadow", "cast"]`
- summary: `null`

_Florence-2-base + RapidOCR + Whisper-base.en_

- duration: `0m10s`
- max mem. usage: `10.01 GiB`
- tags:
  `["startup", "rtup", "shows", "black", "cuff", "bracelet", "word", "white", "capital", "resting", "beige-colored", "surface", "text", "simple", "sans-serif", "font", "centered", "blurred", "making", "focal"]`
- summary: `null`

_Florence-2-large-ft + RapidOCR + Whisper-base.en_

- duration: `0m16s`
- max mem. usage: `10.24 GiB`
- tags:
  `["startup", "rtup", "black", "hair", "clip", "word", "laying", "tan", "colored", "surface", "made", "plastic", "curve", "top"]`
- summary: `null`

_Florence-2-large + RapidOCR + Whisper-base.en_

- duration: `0m18s`
- max mem. usage: `11.18 GiB`
- tags:
  `["startup", "rtup", "close-up", "black", "wristband", "word", "white", "capital", "lying", "beige-colored", "surface", "simple", "sans-serif", "font", "slightly", "curved", "top", "blurred", "making", "focal"]`
- summary: `null`

_Florence-2-base-ft + RapidOCR + Whisper-small.en_

- duration: `0m10s`
- max mem. usage: `8.81 GiB`
- tags: `["startup", "rtup", "black", "wristband", "laying", "beige", "carpet", "shadow", "cast"]`
- summary: `null`

### pexels-eva-bronzini-6956354.jpg

Description: Image of crumpled beige paper with the word Entrepreneur printed on it.

File Metadata: File Size: 0.77 MiB, Duration: n/a, Content Type: `image/jpeg`

_Xenova JS Baseline_

- duration: `0m03s`
- max mem. usage: `2.73 GiB`
- tags: `["envelope", "blue", "white", "plane"]`
- summary: `null`

_Florence-2-base-ft + RapidOCR + Whisper-base.en_

- duration: `0m11s`
- max mem. usage: `8.50 GiB`
- tags: `["entrepreneur", "paper", "beige", "color", "black", "edges", "crumpled"]`
- summary: `null`

_Florence-2-base-ft + Whisper-base.en_

- duration: `0m06s`
- max mem. usage: `2.86 GiB`
- tags: `["entrepreneur", "paper", "beige", "color", "black", "edges", "crumpled"]`
- summary: `null`

_Florence-2-base + RapidOCR + Whisper-base.en_

- duration: `0m10s`
- max mem. usage: `10.01 GiB`
- tags:
  `["entrepreneur", "close-up", "beige-colored", "envelope", "word", "black", "capital", "bottom", "corner", "slightly", "crumpled", "wrinkled", "texture", "blurred", "but", "seems", "desk", "papers", "documents", "scattered"]`
- summary: `null`

_Florence-2-large-ft + RapidOCR + Whisper-base.en_

- duration: `0m18s`
- max mem. usage: `10.24 GiB`
- tags:
  `["entrepreneur", "paper", "word", "black", "capital", "beige", "color", "edges", "slightly", "blurred", "giving", "sense", "depth"]`
- summary: `null`

_Florence-2-large + RapidOCR + Whisper-base.en_

- duration: `0m18s`
- max mem. usage: `11.18 GiB`
- tags:
  `["entrepreneur", "close-up", "paper", "word", "black", "capital", "beige", "color", "slightly", "crumpled", "blurred", "but", "seems", "desk", "papers", "scattered", "around", "focus"]`
- summary: `null`

_Florence-2-base-ft + RapidOCR + Whisper-small.en_

- duration: `0m10s`
- max mem. usage: `8.81 GiB`
- tags: `["entrepreneur", "paper", "beige", "color", "black", "edges", "crumpled"]`
- summary: `null`

### pexels-polina-zimmerman-3782140.jpg

Description: Image of a cork board with pinned notes including one that says HUMAN-oriented Company.

File Metadata: File Size: 2.72 MiB, Duration: n/a, Content Type: `image/jpeg`

_Xenova JS Baseline_

- duration: `0m03s`
- max mem. usage: `2.76 GiB`
- tags: `["sign", "wall"]`
- summary: `null`

_Florence-2-base-ft + RapidOCR + Whisper-base.en_

- duration: `0m12s`
- max mem. usage: `8.74 GiB`
- tags:
  `["human-orientedcompanypeople", "oriented", "-ompany", "cork", "bulletin", "board", "brown", "two", "pieces", "paper", "pinned", "one", "word", "people", "black", "red", "dot", "blue", "well", "made"]`
- summary: `null`

_Florence-2-base-ft + Whisper-base.en_

- duration: `0m07s`
- max mem. usage: `2.89 GiB`
- tags:
  `["human-orientedcompanypeople", "cork", "bulletin", "board", "brown", "two", "pieces", "paper", "pinned", "one", "word", "people", "black", "red", "dot", "blue", "well", "made"]`
- summary: `null`

_Florence-2-base + RapidOCR + Whisper-base.en_

- duration: `0m11s`
- max mem. usage: `10.01 GiB`
- tags:
  `["human-orientedcompanypeople 1", "oriented", "-ompany", "shows", "cork", "bulletin", "board", "three", "sticky", "notes", "pinned", "white", "black", "text", "reads", "human-oriented", "company", "people", "two", "yellow"]`
- summary: `null`

_Florence-2-large-ft + RapidOCR + Whisper-base.en_

- duration: `0m20s`
- max mem. usage: `10.24 GiB`
- tags:
  `["1human-orientedcompanypeople", "oriented", "-ompany", "two", "pieces", "paper", "pinned", "cork", "bulletin", "board", "first", "human-oriented", "company", "black", "marker", "second", "word", "people", "red", "small"]`
- summary: `null`

_Florence-2-large + RapidOCR + Whisper-base.en_

- duration: `0m21s`
- max mem. usage: `11.18 GiB`
- tags:
  `["shows", "two", "small", "white", "cards", "pinned", "cork", "bulletin", "board", "first", "card", "human-oriented", "company", "black", "cursive", "font", "number", "red", "second", "people"]`
- summary: `null`

_Florence-2-base-ft + RapidOCR + Whisper-small.en_

- duration: `0m12s`
- max mem. usage: `8.81 GiB`
- tags:
  `["human-orientedcompanypeople", "oriented", "-ompany", "cork", "bulletin", "board", "brown", "two", "pieces", "paper", "pinned", "one", "word", "people", "black", "red", "dot", "blue", "well", "made"]`
- summary: `null`

### pexels-tima-miroshnichenko-6474474.jpg

Description: Image of a hand holding a fan of paint or color swatches.

File Metadata: File Size: 2.03 MiB, Duration: n/a, Content Type: `image/jpeg`

_Xenova JS Baseline_

- duration: `0m03s`
- max mem. usage: `2.75 GiB`
- tags: `["person", "paper", "string"]`
- summary: `null`

_Florence-2-base-ft + RapidOCR + Whisper-base.en_

- duration: `0m11s`
- max mem. usage: `8.74 GiB`
- tags:
  `["person", "holding", "color", "swatch", "different", "shades", "black", "wearing", "white", "shirt", "wall", "gray", "venato", "c2", "h246", "paint", "anaapxmtek", "konnekuma", "l30", "l45"]`
- summary: `null`

_Florence-2-base-ft + Whisper-base.en_

- duration: `0m06s`
- max mem. usage: `2.89 GiB`
- tags:
  `["panteneck | paint | paint", "person", "holding", "color", "swatch", "different", "shades", "black", "wearing", "white", "shirt", "wall", "gray", "paint", "panteneck"]`
- summary: `null`

_Florence-2-base + RapidOCR + Whisper-base.en_

- duration: `0m17s`
- max mem. usage: `10.01 GiB`
- tags:
  `["shows", "person's", "hand", "holding", "fan", "color", "swatches", "made", "multiple", "shades", "different", "colors", "arranged", "fan-like", "pattern", "range", "light", "dark", "some", "having"]`
- summary: `null`

_Florence-2-large-ft + RapidOCR + Whisper-base.en_

- duration: `0m25s`
- max mem. usage: `10.24 GiB`
- tags:
  `["hand", "holding", "fan", "color", "samples", "different", "shades", "black", "gray", "wall", "venato", "c2", "h246", "lap", "lip", "pm5la", "17pm5lap", "17pm5lip", "am5lat", "anaapxmtek"]`
- summary: `null`

_Florence-2-large + RapidOCR + Whisper-base.en_

- duration: `0m27s`
- max mem. usage: `11.18 GiB`
- tags:
  `["shows", "hand", "holding", "color", "palette", "made", "multiple", "shades", "different", "colors", "arranged", "fan-like", "manner", "rows", "columns", "each", "shade", "having", "range", "light"]`
- summary: `null`

_Florence-2-base-ft + RapidOCR + Whisper-small.en_

- duration: `0m12s`
- max mem. usage: `8.81 GiB`
- tags:
  `["person", "holding", "color", "swatch", "different", "shades", "black", "wearing", "white", "shirt", "wall", "gray", "venato", "c2", "h246", "paint", "anaapxmtek", "konnekuma", "l30", "l45"]`
- summary: `null`
