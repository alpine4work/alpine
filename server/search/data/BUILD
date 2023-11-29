load("@aspect_rules_js//js:defs.bzl", "js_library")
load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "data",
    test_deps = [
        "//server/dynamo/test_helpers",
        "//server/spaces/test_helpers",
    ],
    deps = [
        ":data_data",
        "//:node_modules/@types/fs-extra",
        "//:node_modules/@xenova/transformers",
        "//:node_modules/fs-extra",
        "//:node_modules/natural",
        "//:node_modules/prosemirror-model",
        "//server/chat/data",
        "//server/documents/data",
        "//server/forum/data",
        "//server/helpers/node",
        "//server/opensearch",
        "//server/search/core",
        "//server/tasks/data",
        "//shared/error",
        "//shared/helpers",
        "//shared/schema",
    ],
)

# In a `js_library()` because `ts_project()` doesn't support `no_copy_to_bin`.
js_library(
    name = "data_data",
    data = [
        "@cohere_embed_english_light_v3_0_tokenizer//file",
        "@cohere_embed_english_light_v3_0_tokenizer_config//file",
    ],
    no_copy_to_bin = [
        "@cohere_embed_english_light_v3_0_tokenizer//file",
        "@cohere_embed_english_light_v3_0_tokenizer_config//file",
    ],
)
