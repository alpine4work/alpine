load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "rpc",
    visibility = [
        "//app:__subpackages__",
        "//client:__subpackages__",
    ],
    deps = [
        "//:node_modules/@types/react",
        "//:node_modules/react",
        "//:node_modules/swr",
        "//client/context",
        "//shared/context",
        "//shared/error",
        "//shared/helpers",
        "//shared/rpc",
        "//shared/schema",
        "//shared/tracer",
    ],
)
