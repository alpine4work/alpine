load("@aspect_rules_js//js:defs.bzl", "js_binary")
load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "queue_lib",
    test_deps = ["//server/dynamo/test_helpers"],
    deps = [
        "//server/jobs/core",
        "//server/language_models/all_mini_lm_l6_v2",
        "//server/language_models/cohere_embed_english_v3",
        "//server/node",
        "//server/search/data/index",
        "//server/tasks/data",
        "//shared/error",
        "//shared/helpers",
        "//shared/schema",
    ],
)

js_binary(
    name = "queue",
    data = [":queue_lib"],
    entry_point = "job_queue_service.js",
    visibility = [
        "//app/integration_tests:__pkg__",
    ],
)
