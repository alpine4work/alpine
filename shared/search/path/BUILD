load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "path",
    visibility = [
        "//app:__subpackages__",
        "//client/web:__subpackages__",
        "//shared/remix:__subpackages__",
    ],
    deps = [
        "//shared/chat",
        "//shared/design",
        "//shared/documents",
        "//shared/files",
        "//shared/forum",
        "//shared/helpers",
        "//shared/id",
        "//shared/search",
        "//shared/sites",
        "//shared/tasks",
    ],
)
