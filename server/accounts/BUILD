load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "accounts",
    test_deps = [
        "//server/dynamo/test_helpers",
        "//server/spaces",
        "//server/spaces/test_helpers",
    ],
    visibility = [
        "//admin/crawl:__pkg__",
        "//app:__pkg__",
        "//server:__subpackages__",
    ],
    deps = [
        "//:node_modules/date-fns",
        "//server/dynamo/core",
        "//server/emails",
        "//server/helpers",
        "//server/jobs/core",
        "//server/tokens",
        "//shared/accounts",
        "//shared/avatar",
        "//shared/context",
        "//shared/error",
        "//shared/helpers",
        "//shared/id",
        "//shared/schema",
    ],
)
