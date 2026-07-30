# File processor Whisper bundle

This directory defines the Bazel data target that packages the local Whisper files used by file
metadata generation in `FileProcessorService` and `process_file_lambda`.

## Why we package only a subset

The upstream Hugging Face repos for `whisper-base.en` include many alternative ONNX exports for the
same model:

- different numeric formats (`fp16`, `int8`, `q4`, etc.)
- different decoder layouts (`decoder_model`, `decoder_with_past_model`, `decoder_model_merged`,
  etc.)

Our runtime only needs one working configuration. With `@xenova/transformers` `2.8.0`, the automatic
speech recognition pipeline we use is satisfied by:

- tokenizer/config files: `added_tokens.json`, `config.json`, `generation_config.json`,
  `merges.txt`, `normalizer.json`, `preprocessor_config.json`, `special_tokens_map.json`,
  `tokenizer.json`, `tokenizer_config.json`, `vocab.json`
- ONNX weights: `onnx/encoder_model_quantized.onnx` `onnx/decoder_model_merged_quantized.onnx`

That keeps the packaged artifact much smaller than mirroring the full upstream repo.

## Why the ONNX weights come from Xenova

Our repo currently pins `onnxruntime-node` `1.14.0`. In local testing, the
`onnx-community/whisper-base.en` quantized ONNX exports fail to load there with
`Unsupported model IR version: 9`, while the `Xenova/whisper-base.en` quantized ONNX exports load
successfully with the same `@xenova/transformers` version and runtime. So we intentionally package
the Xenova ONNX files for runtime compatibility.

## Why this is safe

This is safe because the omitted files are alternative model exports, not extra pieces required by
the specific loader path we run today. We materialize a local directory with exactly the files our
current `@xenova/transformers` integration expects, then point
`pipeline("automatic-speech-recognition", ...)` at that directory.

If the subset ever stops being sufficient, the integration does not silently use partial weights:

- the local materializer only succeeds when every required packaged file exists
- the ASR startup path is covered by
  `materialize_packaged_file_process_whisper_model_path_if_exists.test.ts`
- changing `@xenova/transformers`, the selected Whisper repo, or the ASR loading strategy should
  prompt a review of this file list

## When to revisit this

Re-check the subset if any of the following change:

- `@xenova/transformers` version
- Whisper model repo or revision
- ASR pipeline options or model-loading code in `process_file_generate_metadata.ts`
- desire to use a different ONNX precision/runtime tradeoff
