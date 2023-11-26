load("@aspect_rules_js//js:defs.bzl", "js_library")
load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "index",
    test_deps = [
        "//server/dynamo/test_helpers",
        "//server/spaces/test_helpers",
        "//shared/documents",
    ],
    deps = [
        ":index_data",
        "//:node_modules/@types/fs-extra",
        "//:node_modules/@xenova/transformers",
        "//:node_modules/fs-extra",
        "//:node_modules/natural",
        "//:node_modules/prosemirror-model",
        "//server/documents/data",
        "//server/helpers/node",
        "//server/opensearch",
        "//shared/error",
        "//shared/helpers",
        "//shared/schema",
    ],
)

# In a `js_library()` because `ts_project()` doesn't support `no_copy_to_bin`.
js_library(
    name = "index_data",
    data = [
        "@cohere_embed_english_light_v3_0_tokenizer//file",
        "@cohere_embed_english_light_v3_0_tokenizer_config//file",
    ],
    no_copy_to_bin = [
        "@cohere_embed_english_light_v3_0_tokenizer//file",
        "@cohere_embed_english_light_v3_0_tokenizer_config//file",
    ],
)
