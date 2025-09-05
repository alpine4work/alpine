load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "data",
    test_deps = [
        "//server/bots/test_helpers",
        "//server/chat/data:data_testonly",
        "//server/dynamo/test_helpers",
        "//server/forum/data:data_testonly",
        "//server/forum/test_helpers",
        "//server/spaces/test_helpers",
    ],
    visibility = [
        "//admin/crawl:__pkg__",
        "//server:__subpackages__",
    ],
    deps = [
        "//:node_modules/pretty-bytes",
        "//server/cloudflare/r2",
        "//server/context",
        "//server/dynamo/core",
        "//server/dynamo/core/general_realtime",
        "//server/helpers",
        "//server/spaces",
        "//shared/context",
        "//shared/error",
        "//shared/files",
        "//shared/helpers",
        "//shared/id",
        "//shared/schema",
    ],
)
