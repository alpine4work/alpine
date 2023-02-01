load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "posts",
    visibility = [
        "//app:__subpackages__",
        "//client:__subpackages__",
    ],
    deps = [
        "//:node_modules/@types/react",
        "//:node_modules/functional-red-black-tree",
        "//:node_modules/react",
        "//:node_modules/react-aria",
        "//client/content",
        "//client/context",
        "//client/design",
        "//client/messaging",
        "//client/spaces",
        "//shared/helpers",
        "//shared/models",
        "//shared/rpc",
    ],
)
