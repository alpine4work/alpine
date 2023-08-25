load("@aspect_rules_js//js:defs.bzl", "js_binary")
load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "realtime_lib",
    test_deps = [
        "//server/dynamo/test_helpers",
        "//server/spaces/test_helpers",
        "//server/tasks/realtime/test_helpers",
        "//server/tasks/test_helpers",
        "//shared/tasks/test_helpers",
    ],
    visibility = ["//server/tasks/realtime/test_helpers:__pkg__"],
    deps = [
        "//:node_modules/@types/bintrees",
        "//:node_modules/bintrees",
        "//:node_modules/fs-extra",
        "//server/node",
        "//server/notifications/data",
        "//server/opensearch",
        "//server/tasks/data",
        "//server/tokens",
        "//server/web_socket",
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
