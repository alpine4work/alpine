load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "context_module",
    visibility = [
        "//app:__pkg__",
        "//server:__subpackages__",
    ],
    deps = [
        "//server/context",
        "//server/documents/data",
        "//server/forum/data",
        "//server/helpers",
        "//server/search/data/index",
        "//server/spaces",
        "//server/tasks/data",
        "//shared/context",
        "//shared/error",
        "//shared/files",
        "//shared/helpers",
        "//shared/id",
        "//shared/schema",
        "//shared/tasks",
    ],
)
