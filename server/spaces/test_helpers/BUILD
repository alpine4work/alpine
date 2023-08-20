load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "test_helpers",
    testonly = True,
    visibility = ["//server:__subpackages__"],
    deps = [
        "//server/accounts",
        "//server/dynamo/core",
        "//server/dynamo/test_helpers",
        "//server/spaces",
        "//shared/helpers",
        "//shared/id",
    ],
)
