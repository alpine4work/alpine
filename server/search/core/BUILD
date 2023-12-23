load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "core",
    visibility = [
        "//admin/dynamo:__pkg__",
        "//server:__subpackages__",
    ],
    deps = [
        "//server/dynamo/core",
        "//shared/error",
        "//shared/helpers",
        "//shared/id",
        "//shared/schema",
        "//shared/search",
    ],
)
