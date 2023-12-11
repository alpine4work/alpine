load("@aspect_rules_js//js:defs.bzl", "js_binary")
load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "queue_lib",
    test_deps = ["//server/dynamo/test_helpers"],
    deps = [
        "//server/jobs/core",
        "//server/node",
        "//server/search/data",
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
)
