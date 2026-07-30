load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "realtime",
    test_deps = ["//server/dynamo/test_helpers"],
    visibility = ["//server:__subpackages__"],
    deps = [
        "//:node_modules/prosemirror-transform",
        "//server/cloudflare",
        "//shared/content",
        "//shared/error",
        "//shared/helpers",
        "//shared/id",
        "//shared/messaging",
        "//shared/reactions",
        "//shared/rpc",
        "//shared/schema",
    ],
)
