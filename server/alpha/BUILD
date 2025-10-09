load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "alpha",
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
        "//:node_modules/date-fns",
        "//server/accounts",
        "//server/context",
        "//server/dynamo/core",
        "//server/emails",
        "//server/forum/data",
        "//server/search/data/table",
        "//server/spaces",
        "//server/spaces/create_space",
        "//shared/alpha",
        "//shared/context",
        "//shared/error",
        "//shared/helpers",
        "//shared/id",
        "//shared/schema",
    ],
)
