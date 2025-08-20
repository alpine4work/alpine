load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "protocol",
    visibility = [
        "//app:__subpackages__",
        "//server/edge:__subpackages__",
        "//server/files/processor:__subpackages__"
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
