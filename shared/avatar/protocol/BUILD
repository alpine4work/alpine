load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "protocol",
    visibility = [
        "//server/edge:__subpackages__",
    ],
    deps = [
        "//shared/accounts",
        "//shared/avatar",
        "//shared/error",
        "//shared/files",
        "//shared/id",
        "//shared/schema",
    ],
)
