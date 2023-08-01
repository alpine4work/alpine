load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "index",
    test_deps = [
        "//server/dynamo/test_helpers/shared",
        "//shared/tasks/test_helpers",
    ],
    visibility = ["//admin/adhoc:__pkg__"],
    deps = [
        "//:node_modules/@internationalized/date",
        "//:node_modules/date-fns",
        "//server/opensearch",
        "//shared/error",
        "//shared/helpers",
        "//shared/id",
        "//shared/schema",
        "//shared/tasks",
    ],
)
