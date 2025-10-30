load("@aspect_rules_js//js:defs.bzl", "js_library")
load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "cohere_embed_english_v3",
    visibility = [
        "//app:__pkg__",
        "//server:__subpackages__",
    ],
    deps = [
        ":cohere_embed_english_v3_data",
        "//:node_modules/@types/node",
        "//:node_modules/@xenova/transformers",
        "//server/helpers/node",
        "//server/language_models/core",
        "//shared/error",
        "//shared/helpers",
    ],
)

# For the Cohere model, we only need tokenizer files (which are smaller than
# full model files). We also use Cohere in production so we don't need to avoid
# bundling the model in our production containers.
js_library(
    name = "cohere_embed_english_v3_data",
    data = [
        "@cohere_embed_english_v3_tokenizer//file",
        "@cohere_embed_english_v3_tokenizer_config//file",
    ],
    no_copy_to_bin = [
        "@cohere_embed_english_v3_tokenizer//file",
        "@cohere_embed_english_v3_tokenizer_config//file",
    ],
)
