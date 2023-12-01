load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "data",
    test_deps = [
        "//server/documents/test_helpers",
        "//server/dynamo/test_helpers",
        "//server/spaces/test_helpers",
        "//server/tasks/test_helpers",
    ],
    visibility = ["//server/job/queue:__pkg__"],
    deps = [
        "//:node_modules/@types/fs-extra",
        "//:node_modules/@xenova/transformers",
        "//:node_modules/fs-extra",
        "//:node_modules/natural",
        "//:node_modules/prosemirror-model",
        "//server/chat/data",
        "//server/documents/data",
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
    ],
)
