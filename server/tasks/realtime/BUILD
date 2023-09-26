load("@aspect_rules_js//js:defs.bzl", "js_binary")
load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "realtime_lib",
    test_deps = [
        "//server/accounts/update_name",
        "//server/dynamo/test_helpers",
        "//server/spaces/test_helpers",
        "//server/tasks/realtime/test_helpers",
        "//server/tasks/test_helpers",
        "//shared/tasks/test_helpers",
        "//shared/tracer/dev",
    ],
    tests = {
        # These are kind of chunky tests that use OpenSearch. We configure OpenSearch
        # in tests to use 2 CPUs (see `startOpensearchLocal()`) so reserve those
        # resources in Bazel and one for the test process.
        "task_realtime_connection_test": {
            "size": "medium",
            "tags": ["cpu:3"],
        },
        "task_realtime_server_test": {
            "size": "medium",
            "tags": ["cpu:3"],
        },
    },
    visibility = ["//server/tasks/realtime/test_helpers:__pkg__"],
    deps = [
        "//:node_modules/@types/bintrees",
        "//:node_modules/bintrees",
        "//:node_modules/fs-extra",
        "//server/node",
        "//server/notifications/data",
        "//server/opensearch",
        "//server/tasks/data",
        "//server/tasks/router",
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
