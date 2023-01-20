load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "messaging",
    visibility = [
        "//app:__subpackages__",
        "//client:__subpackages__",
    ],
    deps = [
        "//shared/helpers",
        "//shared/models",
    ],
)
