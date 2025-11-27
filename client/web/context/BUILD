load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "context",
    visibility = [
        "//app:__subpackages__",
        "//client/web:__subpackages__",
    ],
    deps = [
        "//:node_modules/@types/react",
        "//:node_modules/react",
        "//shared/context",
        "//shared/helpers",
        "//shared/rpc",
    ],
)
