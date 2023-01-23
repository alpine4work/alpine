load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "messaging",
    visibility = [
        "//app:__subpackages__",
        "//client:__subpackages__",
    ],
    deps = [
        "//:node_modules/@types/jest",
        "//shared/helpers",
        "//shared/models",
    ],
)
