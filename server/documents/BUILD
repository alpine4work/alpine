load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "documents",
    test_deps = ["//server/dynamo/test"],
    visibility = [
        "//app:__subpackages__",
        "//server:__subpackages__",
    ],
    deps = [
        "//:node_modules/jose",
        "//:node_modules/prosemirror-transform",
        "//server/aws",
        "//server/dynamo",
        "//server/helpers",
        "//server/rpc",
        "//server/tracer",
        "//server/web_socket",
        "//shared/content",
        "//shared/context",
        "//shared/documents",
        "//shared/error",
        "//shared/helpers",
        "//shared/id",
        "//shared/models",
        "//shared/prosemirror",
        "//shared/schema",
        "//shared/tracer",
    ],
)
