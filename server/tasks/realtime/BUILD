load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "realtime",
    test_deps = [
        "//server/dynamo/test_helpers/shared",
        "//shared/tasks/test_helpers",
    ],
    deps = [
        "//:node_modules/unicode-default-word-boundary",
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
