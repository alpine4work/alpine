load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "chat",
    visibility = [
        "//app:__subpackages__",
        "//client:__subpackages__",
    ],
    deps = [
        "//:node_modules/@react-types/shared",
        "//:node_modules/@types/react",
        "//:node_modules/fuse.js",
        "//:node_modules/react",
        "//:node_modules/react-aria",
        "//:node_modules/react-stately",
        "//client/content",
        "//client/helpers",
        "//client/messaging",
        "//client/rpc",
        "//client/search/core",
        "//client/spaces",
        "//client/styles",
        "//client/virtualized",
        "//client/web_socket",
        "//shared/chat",
        "//shared/design",
        "//shared/helpers",
        "//shared/id",
        "//shared/messaging",
    ],
)
