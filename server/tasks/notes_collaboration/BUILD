load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "notes_collaboration",
    test_deps = [
        "//server/cloudflare/test_helpers",
        "//server/dynamo/test_helpers",
        "//server/messaging/realtime/test_helpers",
        "//server/spaces/test_helpers",
        "//server/tasks/data/test_helpers",
    ],
    visibility = ["//server/edge:__subpackages__"],
    deps = [
        "//:node_modules/prosemirror-model",
        "//:node_modules/prosemirror-transform",
        "//server/cloudflare",
        "//server/content",
        "//server/content/collaboration",
        "//server/helpers",
        "//server/messaging/realtime",
        "//server/tracer",
        "//shared/content",
        "//shared/context",
        "//shared/error",
        "//shared/helpers",
        "//shared/id",
        "//shared/prosemirror",
        "//shared/rpc",
        "//shared/schema",
        "//shared/tasks",
        "//shared/tracer",
    ],
)
