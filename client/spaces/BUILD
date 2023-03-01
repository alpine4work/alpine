load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "spaces",
    visibility = [
        "//app:__subpackages__",
        "//client:__subpackages__",
    ],
    deps = [
        "//:node_modules/@types/react",
        "//:node_modules/fuse.js",
        "//:node_modules/react",
        "//client/context",
        "//client/helpers",
        "//shared/helpers",
        "//shared/models",
        "//shared/rpc",
    ],
)
