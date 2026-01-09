load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "context",
    test_deps = ["//server/dynamo/test_helpers"],
    visibility = [
        "//admin:__subpackages__",
        "//app:__pkg__",
        "//server:__subpackages__",
    ],
    deps = [
        "//:node_modules/@types/web-push",
        "//:node_modules/web-push",
        "//server/cloudflare/r2",
        "//server/dynamo/core",
        "//server/helpers",
        "//server/jobs/core",
        "//server/opensearch",
        "//server/tokens",
        "//shared/accounts",
        "//shared/context",
        "//shared/documents",
        "//shared/dynamo",
        "//shared/error",
        "//shared/files",
        "//shared/forum",
        "//shared/helpers",
        "//shared/id",
        "//shared/schema",
        "//shared/search",
        "//shared/tasks",
        "//shared/tracer",
    ],
)
