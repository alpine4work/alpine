load("@aspect_rules_js//js:defs.bzl", "js_library")

# See `README.md` in this directory for why this target intentionally packages
# only a subset of the upstream Whisper repo.
js_library(
    name = "whisper_base_en_data",
    data = [
        "@file_process_whisper_base_en_added_tokens//file",
        "@file_process_whisper_base_en_config//file",
        "@file_process_whisper_base_en_generation_config//file",
        "@file_process_whisper_base_en_merges//file",
        "@file_process_whisper_base_en_normalizer//file",
        "@file_process_whisper_base_en_preprocessor_config//file",
        "@file_process_whisper_base_en_special_tokens_map//file",
        "@file_process_whisper_base_en_tokenizer//file",
        "@file_process_whisper_base_en_tokenizer_config//file",
        "@file_process_whisper_base_en_vocab//file",
        "@file_process_whisper_base_en_encoder_model_quantized//file",
        "@file_process_whisper_base_en_decoder_model_merged_quantized//file",
    ],
    no_copy_to_bin = [
        "@file_process_whisper_base_en_added_tokens//file",
        "@file_process_whisper_base_en_config//file",
        "@file_process_whisper_base_en_generation_config//file",
        "@file_process_whisper_base_en_merges//file",
        "@file_process_whisper_base_en_normalizer//file",
        "@file_process_whisper_base_en_preprocessor_config//file",
        "@file_process_whisper_base_en_special_tokens_map//file",
        "@file_process_whisper_base_en_tokenizer//file",
        "@file_process_whisper_base_en_tokenizer_config//file",
        "@file_process_whisper_base_en_vocab//file",
        "@file_process_whisper_base_en_encoder_model_quantized//file",
        "@file_process_whisper_base_en_decoder_model_merged_quantized//file",
    ],
    visibility = [
        "//server/files/processor:__subpackages__",
        "//server/importer:__subpackages__",
    ],
)
