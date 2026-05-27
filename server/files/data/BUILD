load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "data",
    test_deps = [
        "//server/bots/test_helpers",
        "//server/chat/data",
        "//server/documents/test_helpers",
        "//server/dynamo/test_helpers",
        "//server/files/test_helpers",
        "//server/forum/data",
        "//server/forum/test_helpers",
        "//server/spaces/test_helpers",
        "//server/tasks/data",
        "//server/tasks/test_helpers",
    ],
    visibility = [
        "//admin/crawl:__pkg__",
        "//server:__subpackages__",
    ],
    deps = [
        "//:node_modules/pretty-bytes",
        "//server/access",
        "//server/cloudflare/r2",
        "//server/context",
        "//server/dynamo/core",
        "//server/rynamo",
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
