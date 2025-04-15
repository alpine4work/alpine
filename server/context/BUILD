load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "context",
    test_deps = ["//server/dynamo/test_helpers"],
    visibility = [
        "//admin/crawl:__pkg__",
        "//app:__pkg__",
        "//server:__subpackages__",
    ],
    deps = [
        "//server/accounts",
        "//server/cloudflare/r2",
        "//server/dynamo/core",
        "//server/jobs/core",
        "//shared/context",
        "//shared/helpers",
        "//shared/tracer",
    ],
)
