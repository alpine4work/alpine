load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "chat",
    visibility = [
        "//app:__subpackages__",
        "//client/web:__subpackages__",
    ],
    deps = [
        "//:node_modules/@react-types/shared",
        "//:node_modules/@types/react",
        "//:node_modules/fuse.js",
        "//:node_modules/react",
        "//:node_modules/react-aria",
        "//:node_modules/react-stately",
        "//client/web/content",
        "//client/web/helpers",
        "//client/web/messaging",
        "//client/web/rpc",
        "//client/web/search/core",
        "//client/web/spaces",
        "//client/web/styles",
        "//client/web/virtualized",
        "//client/web/web_socket",
        "//shared/chat",
        "//shared/design",
        "//shared/helpers",
        "//shared/id",
        "//shared/messaging",
    ],
)
