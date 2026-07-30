load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "collaboration",
    test_deps = [
        "//server/cloudflare/test_helpers",
        "//server/documents/test_helpers",
        "//server/dynamo/test_helpers",
        "//server/messaging/realtime/test_helpers",
        "//server/sites/data",
        "//server/sites/test_helpers",
    ],
    visibility = ["//server/edge:__subpackages__"],
    deps = [
        "//:node_modules/prosemirror-transform",
        "//server/cloudflare",
        "//server/content",
        "//server/content/collaboration",
        "//server/helpers",
        "//server/messaging/realtime",
        "//server/tracer",
        "//shared/content",
        "//shared/context",
        "//shared/documents",
        "//shared/error",
        "//shared/helpers",
        "//shared/id",
        "//shared/messaging",
        "//shared/prosemirror",
        "//shared/rpc",
        "//shared/schema",
        "//shared/tracer",
    ],
)
