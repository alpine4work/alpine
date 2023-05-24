load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "forum",
    visibility = [
        "//app:__subpackages__",
        "//client:__subpackages__",
    ],
    deps = [
        "//:node_modules/@types/react",
        "//:node_modules/functional-red-black-tree",
        "//:node_modules/react",
        "//:node_modules/react-aria",
        "//client/cloudflare",
        "//client/content",
        "//client/context",
        "//client/design",
        "//client/messaging",
        "//client/spaces",
        "//shared/forum",
        "//shared/helpers",
        "//shared/rpc",
    ],
)
