load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "spaces",
    test_deps = [
        "//server/dynamo/test_helpers",
        "//server/spaces/with_search",
        "//server/spaces/test_helpers",
    ],
    visibility = [
        "//admin/crawl:__pkg__",
        "//app:__pkg__",
        "//server:__subpackages__",
    ],
    deps = [
        "//:node_modules/fuse.js",
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
