load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "documents",
    visibility = [
        "//app:__subpackages__",
        "//client:__subpackages__",
    ],
    deps = [
        "//:node_modules/@types/scheduler",
        "//:node_modules/motion",
        "//:node_modules/murmurhash",
        "//:node_modules/prosemirror-model",
        "//:node_modules/prosemirror-state",
        "//:node_modules/prosemirror-transform",
        "//:node_modules/scheduler",
        "//client/blobs",
        "//client/content",
        "//client/dev",
        "//client/helpers",
        "//client/messaging",
        "//client/navigation",
        "//client/remix",
        "//client/search/core",
        "//client/styles",
        "//client/virtualized",
        "//client/web_socket",
        "//shared/design",
        "//shared/documents",
        "//shared/helpers",
        "//shared/id",
        "//shared/prosemirror",
    ],
)
