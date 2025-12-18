load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "bots",
    test_deps = [
        "//:node_modules/get-port",
        "//server/bots/test_helpers",
        "//server/dynamo/test_helpers",
        "//server/spaces",
        "//server/spaces/test_helpers",
        "//shared/test_helpers",
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
        "//shared/bots",
        "//shared/context",
        "//shared/error",
        "//shared/helpers",
        "//shared/id",
        "//shared/schema",
        "//shared/spaces",
        "//shared/tracer",
    ],
)
