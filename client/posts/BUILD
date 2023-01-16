load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "posts",
    visibility = [
        "//app:__subpackages__",
        "//client:__subpackages__",
    ],
    deps = [
        "//:node_modules/@types/react",
        "//:node_modules/react",
        "//client/content",
        "//client/context",
        "//client/design",
        "//shared/posts",
        "//shared/rpc",
    ],
)
