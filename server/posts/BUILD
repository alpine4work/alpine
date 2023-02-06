load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "posts",
    visibility = [
        "//app:__subpackages__",
        "//server:__subpackages__",
    ],
    deps = [
        "//server/dynamo",
        "//shared/error",
        "//shared/helpers",
        "//shared/id",
        "//shared/models",
        "//shared/schema",
    ],
)
