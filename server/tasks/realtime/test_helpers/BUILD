load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "test_helpers",
    testonly = True,
    visibility = ["//server:__subpackages__"],
    deps = [
        "//:node_modules/@internationalized/date",
        "//server/dynamo/test_helpers",
        "//server/spaces/test_helpers",
        "//server/tasks/data",
        "//server/tasks/realtime:realtime_lib",
        "//shared/context",
        "//shared/helpers",
        "//shared/id",
        "//shared/tasks",
        "//shared/test_helpers",
    ],
)
