load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "documents",
    test_deps = [
        "//server/dynamo:dynamo_testonly",
        "//server/dynamo/test_helpers/shared",
    ],
    visibility = ["//server/edge:__subpackages__"],
    deps = [
        "//:node_modules/prosemirror-transform",
        "//server/cloudflare",
        "//server/helpers",
        "//server/messaging",
        "//server/tracer",
        "//shared/content",
        "//shared/context",
        "//shared/documents",
        "//shared/error",
        "//shared/helpers",
        "//shared/id",
        "//shared/prosemirror",
        "//shared/schema",
        "//shared/tracer",
    ],
)
