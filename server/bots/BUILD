load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "bots",
    test_deps = [
        "//server/dynamo/test_helpers",
        "//server/spaces/test_helpers",
    ],
    visibility = [
        "//admin/crawl:__pkg__",
        "//app:__pkg__",
        "//server:__subpackages__",
    ],
    deps = [
        "//server/accounts",
        "//server/context",
        "//server/dynamo/core",
        "//shared/context",
        "//shared/error",
        "//shared/helpers",
        "//shared/id",
        "//shared/schema",
        "//shared/spaces",
        "//shared/tracer",
    ],
)
