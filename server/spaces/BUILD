load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "spaces",
    test_deps = [
        "//server/dynamo/test_helpers",
        "//server/spaces/test_helpers",
        "//shared/spaces/test_helpers",
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
        "//server/emails",
        "//server/helpers",
        "//server/jobs/core",
        "//server/tokens",
        "//shared/accounts",
        "//shared/avatar",
        "//shared/context",
        "//shared/error:error_core",
        "//shared/helpers",
        "//shared/helpers:helpers_core",
        "//shared/id",
        "//shared/schema",
        "//shared/spaces",
    ],
)
