load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "test_helpers",
    testonly = True,
    visibility = ["//server/api:__subpackages__"],
    deps = [
        "//server/api/internal/shared",
        "//server/dynamo/test_helpers",
        "//server/tokens",
        "//shared/error",
        "//shared/helpers",
    ],
)
