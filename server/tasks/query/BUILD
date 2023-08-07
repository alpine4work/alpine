load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "query",
    test_deps = ["//server/dynamo/test_helpers/shared"],
    deps = [
        "//server/opensearch",
        "//server/tasks/index",
        "//shared/error",
        "//shared/helpers",
        "//shared/id",
        "//shared/schema",
        "//shared/tasks",
    ],
)
