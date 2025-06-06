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
        "//:node_modules/react-stately",
        "//client/content",
        "//client/context",
        "//client/design",
        "//client/icons",
        "//client/messaging",
        "//client/navigation",
        "//client/search",
        "//client/search/core",
        "//client/shimmer",
        "//client/spaces",
        "//client/web_socket",
        "//shared/forum",
        "//shared/helpers",
        "//shared/rpc",
    ],
)
