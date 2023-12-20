load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "data",
    test_deps = [
        "//server/documents/test_helpers",
        "//server/dynamo/test_helpers",
        "//server/spaces/test_helpers",
        "//server/tasks/test_helpers",
    ],
    tests = {
        "search_entity_index_test": {
            "data": ["//server/language_models/all_mini_lm_l6_v2:all_mini_lm_l6_v2_data_testonly"],
        },
    },
    visibility = [
        "//admin/dynamo:__pkg__",
        "//server/jobs/queue:__pkg__",
        "//server/rpc:__pkg__",
    ],
    deps = [
        "//:node_modules/@types/fs-extra",
        "//:node_modules/@types/mdast",
        "//:node_modules/@xenova/transformers",
        "//:node_modules/compromise",
        "//:node_modules/date-fns",
        "//:node_modules/fs-extra",
        "//:node_modules/mdast-util-from-markdown",
        "//:node_modules/mdast-util-gfm-strikethrough",
        "//:node_modules/micromark-extension-gfm-strikethrough",
        "//:node_modules/murmurhash",
        "//:node_modules/prosemirror-model",
        "//server/chat/data",
        "//server/documents/data",
        "//server/dynamo/core",
        "//server/forum/data",
        "//server/helpers/node",
        "//server/language_models/all_mini_lm_l6_v2",
        "//server/language_models/cohere_embed_english_v3",
        "//server/opensearch",
        "//server/search/core",
        "//server/tasks/data",
        "//shared/error",
        "//shared/helpers",
        "//shared/schema",
        "//shared/search",
    ],
)
