# Media Tagging Bake-Off: Bedrock Gemma

## Overview

This report is the Bedrock-hosted Gemma 3 sibling to the local-only media tagging bake-off. The goal
is to measure what we can get from a relatively cheap managed multimodal model while still staying
far below the cost profile of defaulting every file to a larger premium hosted LLM.

## Goals

- Understand Bedrock Gemma 3 quality on the same corpus we used for local model testing.
- Capture input and output token usage per file so cost is measurable instead of hypothetical.
- Estimate cost per image, per video, and per audio summary using a clear frame-sampling policy.
- Compare a managed multimodal path against the Florence local baseline without changing the test
  corpus.

## Non-goals

- This is not a production integration yet; it is an experiment focused on quality and token cost.
- This does not replace the local model investigation. It complements it.

## Integration

The same two integration shapes still apply here: run inline in `processFile` or schedule a
follow-up job. For Bedrock specifically, a follow-up job may be the safer default if we want to
control cost, concurrency, retries, and regional rate limits more explicitly. Inline `processFile`
integration is still possible, but it would turn file processing time and Bedrock availability into
part of the upload path.

## Methodology

- `tags` means a short list of 5 searchable keywords or phrases ordered by importance.
- `summary` means a concise factual sentence that could plausibly inform alt text or agent-facing
  markdown link text.
- `input tokens` and `output tokens` come directly from the Bedrock Converse API usage field.
- `estimated cost` is computed from Bedrock standard on-demand pricing in `us-east-1` for Gemma 3
  12B: `$0.09` per 1M input tokens and `$0.29` per 1M output tokens.
- Images are sent as a single resized JPEG.
- Audio is transcribed locally with Whisper base, then Gemma 3 summarizes and tags the transcript.
- Videos are sampled into multiple chronological frames, then Gemma 3 analyzes the full frame set
  together plus the transcript when audio exists.
- Video frame counts use this heuristic: one middle frame if duration is under 5 seconds; up to 10
  frames by 60 seconds; up to about 20 frames by 3 minutes; capped at 20 frames.

## Models

This stack was chosen because it gives us a managed multimodal baseline with direct image support,
token accounting, and lower pricing than larger flagship hosted models.

### Bedrock Gemma 3 12B IT + Whisper-base.en

- language: `TypeScript + Amazon Bedrock`
- output suffix: `.gemma.json`
- notes: Gemma 3 12B IT on Amazon Bedrock for image/video understanding and transcript
  summarization; local Whisper base in TypeScript for transcription.
- strengths:
    - Closest experiment here to a managed multimodal model path that still avoids per-file hosted
      LLM calls to larger premium models.
    - Provides token usage and direct Bedrock cost estimates, which lets us reason about operational
      cost much more concretely than the local-only probes.
    - Supports image input directly, so we can test whether a single hosted multimodal model can
      cover both tags and summary generation for images and videos.
- work split:
    - Image and video frame understanding are offloaded to Gemma 3 12B IT on Amazon Bedrock because
      it supports text and image input through the Bedrock Converse API.
    - Audio and video speech transcription are still handled locally by Whisper base in TypeScript
      because this experiment is about using Gemma to analyze transcripts, not about replacing
      speech-to-text.
    - Video frame sampling is handled locally so we can control how many images we send to Bedrock
      and tie the cost estimate to a clear frame-count heuristic.

## Cost Summary

### Image

- files: `13`
- avg input tokens: `339`
- avg output tokens: `55`
- avg estimated cost: `$0.000046`
- median estimated cost: `$0.000046`
- max estimated cost: `$0.000048`

### Video

- files: `14`
- avg input tokens: `1508`
- avg output tokens: `58`
- avg estimated cost: `$0.000153`
- median estimated cost: `$0.000085`
- max estimated cost: `$0.000650`
- avg frames per video: `4.8`
- avg cost per minute of video: `$0.000438`

### Audio

- files: `3`
- avg input tokens: `744`
- avg output tokens: `75`
- avg estimated cost: `$0.000089`
- median estimated cost: `$0.000054`
- max estimated cost: `$0.000178`
- avg cost per minute of audio: `$0.000047`

## Results

### 12987324_3840_2160_30fps.mp4

Description: Video of an aerial view over a road and a construction or village area.

File Metadata: File Size: 206 MiB, Duration: 0m46s, Content Type: `video/mp4`

_Bedrock Gemma 3 12B IT + Whisper-base.en_

- duration: `0m08s`
- max mem. usage: `939 MiB`
- input tokens: `2206`
- output tokens: `65`
- estimated cost: `$0.000217`
- frame sampling:
  `count=8, timestamps=[2.8507645625, 8.5522936875, 14.253822812500001, 19.9553519375, 25.656881062500002, 31.358410187500002, 37.059939312500006, 42.7614684375]`
- tags: `["construction", "land", "development", "road", "vehicles"]`
- summary:
  `"The video shows the progression of land development, starting with a gas station and construction site, and transitioning to a planned residential area with roads and fencing."`

### 12987350_3840_2160_30fps.mp4

Description: Video of an aerial view over farm fields, dirt roads, and scattered buildings.

File Metadata: File Size: 51.7 MiB, Duration: 0m13s, Content Type: `video/mp4`

_Bedrock Gemma 3 12B IT + Whisper-base.en_

- duration: `0m02s`
- max mem. usage: `939 MiB`
- input tokens: `622`
- output tokens: `47`
- estimated cost: `$0.000070`
- frame sampling: `count=2, timestamps=[3.31164175, 9.934925250000001]`
- tags: `["agriculture", "field", "tractor", "farm", "land"]`
- summary: `"A tractor is working in a field divided into rectangular plots."`

### 13986302_2160_3840_25fps.mp4

Description: Video of a blue-gloved hand using a small lab machine or centrifuge.

File Metadata: File Size: 18.1 MiB, Duration: 0m16s, Content Type: `video/mp4`

_Bedrock Gemma 3 12B IT + Whisper-base.en_

- duration: `0m02s`
- max mem. usage: `939 MiB`
- input tokens: `886`
- output tokens: `54`
- estimated cost: `$0.000095`
- frame sampling: `count=3, timestamps=[2.6999999999999997, 8.1, 13.5]`
- tags: `["centrifuge", "lab", "gloves", "sample", "medical"]`
- summary:
  `"A person in gloves is loading a blood sample into a centrifuge in a laboratory setting."`

### 6567878-uhd_2160_4096_25fps.mp4

Description: Video of a man presenting while standing against a dark wall and holding objects in his
hands.

File Metadata: File Size: 44.0 MiB, Duration: 0m33s, Content Type: `video/mp4`

_Bedrock Gemma 3 12B IT + Whisper-base.en_

- duration: `0m03s`
- max mem. usage: `939 MiB`
- input tokens: `1414`
- output tokens: `56`
- estimated cost: `$0.000143`
- frame sampling: `count=5, timestamps=[3.276, 9.828, 16.38, 22.932, 29.483999999999998]`
- tags: `["reading", "paper", "suit", "man", "glasses"]`
- summary:
  `"A man in a suit and glasses appears to be reading a document and then placing it on a wall."`

### F33A4268-2.jpg

Description: Image of a close-up green plant against a blurred background.

File Metadata: File Size: 0.37 MiB, Duration: n/a, Content Type: `image/jpeg`

_Bedrock Gemma 3 12B IT + Whisper-base.en_

- duration: `0m01s`
- max mem. usage: `939 MiB`
- input tokens: `339`
- output tokens: `57`
- estimated cost: `$0.000047`
- frame sampling: `count=1, timestamps=[]`
- tags: `["rosemary", "plant", "herb", "leaves", "green"]`
- summary: `"The image shows a close-up of a sprig of rosemary with its needle-like leaves."`

### IMG_3138.jpg

Description: Image of a baby sitting on a black blanket in front of a dark backdrop.

File Metadata: File Size: 0.35 MiB, Duration: n/a, Content Type: `image/jpeg`

_Bedrock Gemma 3 12B IT + Whisper-base.en_

- duration: `0m01s`
- max mem. usage: `939 MiB`
- input tokens: `339`
- output tokens: `51`
- estimated cost: `$0.000045`
- frame sampling: `count=1, timestamps=[]`
- tags: `["baby", "portrait", "child", "smile", "black"]`
- summary: `"A smiling baby with red hair sits on a black fabric against a black background."`

### IMG_3479.jpg

Description: Image of a baby sitting in a shopping cart and holding a snack.

File Metadata: File Size: 2.77 MiB, Duration: n/a, Content Type: `image/jpeg`

_Bedrock Gemma 3 12B IT + Whisper-base.en_

- duration: `0m01s`
- max mem. usage: `939 MiB`
- input tokens: `339`
- output tokens: `57`
- estimated cost: `$0.000047`
- frame sampling: `count=1, timestamps=[]`
- tags: `["baby", "food", "cart", "superman", "cute"]`
- summary:
  `"A baby wearing a black beanie and a Superman shirt sits in a shopping cart holding a piece of food."`

### IMG_6153.jpg

Description: Image of an Alpine-stickered laptop and a mug on a wooden table in bright sunlight.

File Metadata: File Size: 0.09 MiB, Duration: n/a, Content Type: `image/jpeg`

_Bedrock Gemma 3 12B IT + Whisper-base.en_

- duration: `0m01s`
- max mem. usage: `939 MiB`
- input tokens: `339`
- output tokens: `53`
- estimated cost: `$0.000046`
- frame sampling: `count=1, timestamps=[]`
- tags: `["alpine", "laptop", "coffee", "sunrise", "outdoors"]`
- summary: `"A laptop with Alpine stickers sits next to a mug on a wooden table during sunrise."`

### IMG_6164.jpg

Description: Image of four adults standing on a red dirt trail with red rock mountains behind them.

File Metadata: File Size: 0.57 MiB, Duration: n/a, Content Type: `image/jpeg`

_Bedrock Gemma 3 12B IT + Whisper-base.en_

- duration: `0m01s`
- max mem. usage: `939 MiB`
- input tokens: `339`
- output tokens: `59`
- estimated cost: `$0.000048`
- frame sampling: `count=1, timestamps=[]`
- tags: `["sedona", "hiking", "mountains", "friends", "outdoors"]`
- summary:
  `"Four people stand on a red dirt trail in Sedona, Arizona, with red rock formations in the background."`

### IMG_7212-2.jpg

Description: Image of a black-and-white stage portrait of a young musician giving a thumbs up.

File Metadata: File Size: 0.31 MiB, Duration: n/a, Content Type: `image/jpeg`

_Bedrock Gemma 3 12B IT + Whisper-base.en_

- duration: `0m01s`
- max mem. usage: `942 MiB`
- input tokens: `339`
- output tokens: `55`
- estimated cost: `$0.000046`
- frame sampling: `count=1, timestamps=[]`
- tags: `["portrait", "music", "thumbsup", "blackandwhite", "guitar"]`
- summary: `"A black and white portrait shows a young man playing guitar and giving a thumbs up."`

### PXL_20260214_030737769.mp4

Description: Video of a colorful video game character standing in a futuristic room.

File Metadata: File Size: 17.3 MiB, Duration: 0m07s, Content Type: `video/mp4`

_Bedrock Gemma 3 12B IT + Whisper-base.en_

- duration: `0m02s`
- max mem. usage: `1.68 GiB`
- input tokens: `632`
- output tokens: `59`
- estimated cost: `$0.000074`
- frame sampling: `count=2, timestamps=[1.633389, 4.900167]`
- tags: `["overwatch", "galacta", "bot", "gameplay", "character"]`
- summary:
  `"The video shows a Galacta Bot character in Overwatch, likely preparing or using an ultimate ability."`

### PXL_20260321_140600157.mp4

Description: Video of an animal swimming underwater in an aquarium enclosure.

File Metadata: File Size: 8.67 MiB, Duration: 0m03s, Content Type: `video/mp4`

_Bedrock Gemma 3 12B IT + Whisper-base.en_

- duration: `0m02s`
- max mem. usage: `1.74 GiB`
- input tokens: `378`
- output tokens: `45`
- estimated cost: `$0.000047`
- frame sampling: `count=1, timestamps=[1.6306835]`
- tags: `["dolphin", "aquarium", "water", "swim", "animal"]`
- summary: `"A dolphin swims underwater in an aquarium enclosure."`

### PXL_20260326_132234127~2.mp4

Description: Video of a sunset over distant mountains and clouds.

File Metadata: File Size: 9.58 MiB, Duration: 0m09s, Content Type: `video/mp4`

_Bedrock Gemma 3 12B IT + Whisper-base.en_

- duration: `0m02s`
- max mem. usage: `1.77 GiB`
- input tokens: `630`
- output tokens: `55`
- estimated cost: `$0.000073`
- frame sampling: `count=2, timestamps=[2.191026, 6.573078]`
- tags: `["sunset", "mountains", "sky", "orange", "clouds"]`
- summary:
  `"The video shows a sunset over a range of mountains with orange and yellow hues in the sky."`

### PXL_20260425_024503603.mp4

Description: Video of a band performing on a small dark stage.

File Metadata: File Size: 16.5 MiB, Duration: 0m07s, Content Type: `video/mp4`

_Bedrock Gemma 3 12B IT + Whisper-base.en_

- duration: `0m02s`
- max mem. usage: `1.81 GiB`
- input tokens: `632`
- output tokens: `47`
- estimated cost: `$0.000071`
- frame sampling: `count=2, timestamps=[1.63850825, 4.91552475]`
- tags: `["music", "band", "performance", "live", "drums"]`
- summary: `"A band is performing live music on a dimly lit stage."`

### Screen Recording 2026-05-15 at 10.15.22 AM.mov

Description: Screen recording of an Alpine product discussion page with comments and a post about
the Design System V2 documentation site.

File Metadata: File Size: 1.93 MiB, Duration: 0m08s, Content Type: `video/quicktime`

_Bedrock Gemma 3 12B IT + Whisper-base.en_

- duration: `0m01s`
- max mem. usage: `1.81 GiB`
- input tokens: `622`
- output tokens: `53`
- estimated cost: `$0.000071`
- frame sampling: `count=2, timestamps=[1.92083325, 5.76249975]`
- tags: `["comments", "product", "design", "documentation", "script"]`
- summary:
  `"The video shows a product discussion thread with numerous comments and documentation updates regarding a design system."`

### Screen Recording 2026-05-15 at 10.15.40 AM.mov

Description: Screen recording of an Alpine product discussion page with comments and design system
documentation text.

File Metadata: File Size: 1.60 MiB, Duration: 0m08s, Content Type: `video/quicktime`

_Bedrock Gemma 3 12B IT + Whisper-base.en_

- duration: `0m02s`
- max mem. usage: `1.81 GiB`
- input tokens: `622`
- output tokens: `63`
- estimated cost: `$0.000074`
- frame sampling: `count=2, timestamps=[1.925, 5.775]`
- tags: `["comment", "documentation", "mention", "product", "user"]`
- summary:
  `"The video shows a user attempting to mention a large group of people in a comment on a product documentation page, but receiving an error message."`

### YTDown_YouTube_Animate-Fish-in-Blender-Lazy-Tutorials_Media_58lc8sLpJzY_002_720p.mp4

Description: Video of a Blender tutorial showing a fish model and node settings used to animate it
swimming.

File Metadata: File Size: 1.90 MiB, Duration: 1m00s, Content Type: `video/mp4`

_Bedrock Gemma 3 12B IT + Whisper-base.en_

- duration: `0m10s`
- max mem. usage: `1.90 GiB`
- input tokens: `3055`
- output tokens: `59`
- estimated cost: `$0.000292`
- frame sampling:
  `count=10, timestamps=[3.0058231500000003, 9.01746945, 15.02911575, 21.04076205, 27.05240835, 33.06405465, 39.075700950000005, 45.08734725, 51.09899355, 57.11063985]`
- tags: `["fish", "blender", "modeling", "displacement", "animation"]`
- summary:
  `"The video demonstrates creating and animating a school of fish in Blender using modeling, texturing, and a displacement modifier."`

### YTDown_YouTube_Animate-Fish-in-Blender-Lazy-Tutorials_Media_58lc8sLpJzY_007_128k.mp3

Description: Audio from a Blender tutorial about modeling and animating a swimming fish.

File Metadata: File Size: 1.01 MiB, Duration: 1m00s, Content Type: `audio/mpeg`

_Bedrock Gemma 3 12B IT + Whisper-base.en_

- duration: `0m08s`
- max mem. usage: `1.97 GiB`
- input tokens: `404`
- output tokens: `61`
- estimated cost: `$0.000054`
- tags: `["fish", "texture", "displacement", "animation", "shader"]`
- summary:
  `"The tutorial demonstrates creating a fish model with animated swimming motion and detailed textures using displacement and shader techniques to form a school of fish."`

### YTDown_YouTube_Nobody-Ever-Buys-Salt_Media_XHsmaxrvsw0_002_720p.mp4

Description: Video of a salt commercial with a salt canister on a shelf and a person pouring salt.

File Metadata: File Size: 3.43 MiB, Duration: 0m30s, Content Type: `video/mp4`

_Bedrock Gemma 3 12B IT + Whisper-base.en_

- duration: `0m04s`
- max mem. usage: `1.97 GiB`
- input tokens: `1506`
- output tokens: `52`
- estimated cost: `$0.000151`
- frame sampling:
  `count=5, timestamps=[3.0069841000000004, 9.0209523, 15.0349205, 21.0488887, 27.0628569]`
- tags: `["salt", "abandonment", "struggle", "video", "person"]`
- summary: `"A man discusses the ubiquity of salt while being playfully sprayed with it."`

### YTDown_YouTube_Nobody-Ever-Buys-Salt_Media_XHsmaxrvsw0_007_128k.mp3

Description: Audio of a comedic spoken-word ad about how nobody ever buys salt.

File Metadata: File Size: 0.55 MiB, Duration: 0m30s, Content Type: `audio/mpeg`

_Bedrock Gemma 3 12B IT + Whisper-base.en_

- duration: `0m03s`
- max mem. usage: `1.99 GiB`
- input tokens: `178`
- output tokens: `61`
- estimated cost: `$0.000034`
- tags: `["salt", "abandonment", "life", "strife", "default"]`
- summary:
  `"The speaker reflects on the constant presence of salt, comparing it to the recurring experiences of abandonment and hardship in their life."`

### YTDown_YouTube_Taco-Bell-Commercial-2025-USA-5-7-and-9-\_Media_BpXG8kWDZ1E_002_720p.mp4

Description: Video of a Taco Bell commercial with burritos, drinks, and promotional offer text.

File Metadata: File Size: 4.22 MiB, Duration: 0m15s, Content Type: `video/mp4`

_Bedrock Gemma 3 12B IT + Whisper-base.en_

- duration: `0m03s`
- max mem. usage: `1.99 GiB`
- input tokens: `953`
- output tokens: `76`
- estimated cost: `$0.000108`
- frame sampling: `count=3, timestamps=[2.5077551666666666, 7.5232655, 12.538775833333334]`
- tags: `["taco bell", "luxe", "cravings", "burrito", "food"]`
- summary:
  `"Taco Bell is advertising their new Luxe Cravings Boxes, available in $5, $7, and $9 options, including a Flamin' Hot Groot Cheese Burrito."`

### YTDown_YouTube_The-Windows-Update-We-All-Wanted_Media_Kxn62gTEpIU_003_480p.mp4

Description: Video of a tech-news presenter discussing Windows Update while article screenshots
appear on screen.

File Metadata: File Size: 29.7 MiB, Duration: 9m05s, Content Type: `video/mp4`

_Bedrock Gemma 3 12B IT + Whisper-base.en_

- duration: `0m58s`
- max mem. usage: `1.99 GiB`
- input tokens: `6947`
- output tokens: `86`
- estimated cost: `$0.000650`
- frame sampling:
  `count=20, timestamps=[13.620825400000001, 40.8624762, 68.104127, 95.34577780000001, 122.58742860000001, 149.8290794, 177.0707302, 204.31238100000002, 231.55403180000002, 258.7956826, 286.0373334, 313.2789842, 340.520635, 367.76228580000003, 395.00393660000003, 422.24558740000003, 449.48723820000004, 476.72888900000004, 503.97053980000004, 531.2121906]`
- tags: `["amd", "microsoft", "ai", "gaming", "samsung"]`
- summary:
  `"This video discusses recent tech news including Microsoft's Cloud-Initiated Driver Recovery, AMD's FSR 4.1 update, Samsung worker strikes, AI's impact on education, and Instagram's new 'Instants' feature."`

### YTDown_YouTube_The-Windows-Update-We-All-Wanted_Media_Kxn62gTEpIU_009_128k.mp3

Description: Audio of a tech-news segment about Windows Update, drivers, GPUs, and other industry
stories.

File Metadata: File Size: 9.93 MiB, Duration: 9m05s, Content Type: `audio/mpeg`

_Bedrock Gemma 3 12B IT + Whisper-base.en_

- duration: `0m50s`
- max mem. usage: `1.99 GiB`
- input tokens: `1649`
- output tokens: `103`
- estimated cost: `$0.000178`
- tags: `["windows11", "samsung", "fsr4", "ai", "instagram"]`
- summary:
  `"Microsoft will automatically roll back bad Windows updates, Samsung workers are striking over bonuses, AMD's FSR 4.1 is expanding to older GPUs, AI is impacting student grades, and Instagram released a Snapchat-like feature called 'Instance'."`

### pexels-cottonbro-6568667.jpg

Description: Image of a man in dark clothing standing against a dark wall while holding papers or a
notebook.

File Metadata: File Size: 1.00 MiB, Duration: n/a, Content Type: `image/jpeg`

_Bedrock Gemma 3 12B IT + Whisper-base.en_

- duration: `0m01s`
- max mem. usage: `1.99 GiB`
- input tokens: `339`
- output tokens: `58`
- estimated cost: `$0.000047`
- frame sampling: `count=1, timestamps=[]`
- tags: `["man", "reading", "book", "suit", "glasses"]`
- summary:
  `"A man in a suit and glasses is reading a book and holding a piece of paper against a dark gray background."`

### pexels-cottonbro-7505174.jpg

Description: Image of a woman browsing books on shelves in a bright room.

File Metadata: File Size: 1.34 MiB, Duration: n/a, Content Type: `image/jpeg`

_Bedrock Gemma 3 12B IT + Whisper-base.en_

- duration: `0m01s`
- max mem. usage: `2.01 GiB`
- input tokens: `339`
- output tokens: `55`
- estimated cost: `$0.000046`
- frame sampling: `count=1, timestamps=[]`
- tags: `["woman", "design", "materials", "interior", "shelf"]`
- summary:
  `"A woman in an orange shirt examines samples of materials displayed on shelves in a bright, modern space."`

### pexels-eva-bronzini-6475529.jpg

Description: Image of an envelope with letter tiles spelling IDEA.

File Metadata: File Size: 1.62 MiB, Duration: n/a, Content Type: `image/jpeg`

_Bedrock Gemma 3 12B IT + Whisper-base.en_

- duration: `0m02s`
- max mem. usage: `2.03 GiB`
- input tokens: `339`
- output tokens: `56`
- estimated cost: `$0.000047`
- frame sampling: `count=1, timestamps=[]`
- tags: `["idea", "stamp", "wood", "text", "vintage"]`
- summary:
  `"A wooden stamp with the word 'IDEA' printed in vintage-style letters rests on a textured surface."`

### pexels-eva-bronzini-6956318.jpg

Description: Image of a black ribbon or wristband with the word STARTUP on a beige surface.

File Metadata: File Size: 0.87 MiB, Duration: n/a, Content Type: `image/jpeg`

_Bedrock Gemma 3 12B IT + Whisper-base.en_

- duration: `0m01s`
- max mem. usage: `2.05 GiB`
- input tokens: `339`
- output tokens: `50`
- estimated cost: `$0.000045`
- frame sampling: `count=1, timestamps=[]`
- tags: `["startup", "bracelet", "sand", "black", "jewelry"]`
- summary: `"A black bracelet with the word 'startup' is partially buried in sand."`

### pexels-eva-bronzini-6956354.jpg

Description: Image of crumpled beige paper with the word Entrepreneur printed on it.

File Metadata: File Size: 0.77 MiB, Duration: n/a, Content Type: `image/jpeg`

_Bedrock Gemma 3 12B IT + Whisper-base.en_

- duration: `0m01s`
- max mem. usage: `2.07 GiB`
- input tokens: `339`
- output tokens: `53`
- estimated cost: `$0.000046`
- frame sampling: `count=1, timestamps=[]`
- tags: `["entrepreneur", "business", "paper", "text", "startup"]`
- summary: `"The image shows the word 'entrepreneur' printed on a stack of brown paper."`

### pexels-polina-zimmerman-3782140.jpg

Description: Image of a cork board with pinned notes including one that says HUMAN-oriented Company.

File Metadata: File Size: 2.72 MiB, Duration: n/a, Content Type: `image/jpeg`

_Bedrock Gemma 3 12B IT + Whisper-base.en_

- duration: `0m01s`
- max mem. usage: `2.10 GiB`
- input tokens: `339`
- output tokens: `60`
- estimated cost: `$0.000048`
- frame sampling: `count=1, timestamps=[]`
- tags: `["corkboard", "company", "people", "notes", "office"]`
- summary:
  `"The image shows handwritten notes pinned to a corkboard with phrases like 'human-oriented company' and 'people'."`

### pexels-tima-miroshnichenko-6474474.jpg

Description: Image of a hand holding a fan of paint or color swatches.

File Metadata: File Size: 2.03 MiB, Duration: n/a, Content Type: `image/jpeg`

_Bedrock Gemma 3 12B IT + Whisper-base.en_

- duration: `0m01s`
- max mem. usage: `2.12 GiB`
- input tokens: `339`
- output tokens: `50`
- estimated cost: `$0.000045`
- frame sampling: `count=1, timestamps=[]`
- tags: `["color", "paint", "palette", "hand", "selection"]`
- summary: `"A hand holds a fan of paint color swatches against a gray wall."`
