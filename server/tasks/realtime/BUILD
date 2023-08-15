load("@aspect_rules_js//js:defs.bzl", "js_binary")
load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "realtime_lib",
    test_deps = [
        "//server/dynamo/test_helpers/shared",
        "//shared/tasks/test_helpers",
    ],
    deps = [
        "//:node_modules/@types/bintrees",
        "//:node_modules/bintrees",
        "//server/dynamo",
        "//server/node",
        "//server/opensearch",
        "//server/tasks/index",
        "//shared/error",
        "//shared/helpers",
        "//shared/id",
        "//shared/schema",
        "//shared/tasks",
    ],
)

js_binary(
    name = "realtime",
    data = [":realtime_lib"],
    entry_point = "task_realtime_service.js",
)
