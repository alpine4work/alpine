load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "read",
    visibility = [
        "//admin/dynamo:__pkg__",
        "//app:__pkg__",
        "//server:__subpackages__",
    ],
    deps = [
        "//server/context",
        "//server/documents/data",
        "//server/feed/data",
        "//server/forum/data",
        "//server/helpers",
        "//server/spaces",
        "//server/tasks/data",
        "//shared/context",
        "//shared/error",
        "//shared/feed",
        "//shared/helpers",
        "//shared/id",
        "//shared/schema",
    ],
)
