load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "test_helpers",
    testonly = True,
    visibility = ["//server:__subpackages__"],
    deps = [
        "//server/dynamo/test_helpers",
        "//server/spaces/test_helpers",
        "//server/tasks/data",
        "//shared/helpers",
        "//shared/id",
    ],
)
