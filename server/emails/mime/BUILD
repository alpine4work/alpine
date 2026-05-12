load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "mime",
    visibility = [
        "//admin:__subpackages__",
        "//server:__subpackages__",
    ],
    deps = [
        "//shared/emails",
        "//shared/error",
        "//shared/helpers",
        "//shared/id",
    ],
)
