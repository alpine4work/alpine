load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "feed",
    test_deps = [
        "//server/documents/test_helpers",
        "//server/forum/test_helpers",
        "//server/tasks/test_helpers",
    ],
    tests = {
        "feed_table_test": {"size": "medium"},
        "feed_table_slow_test": {"size": "medium"},
    },
    visibility = [
        "//admin/crawl:__pkg__",
        "//admin/dynamo:__pkg__",
        "//app:__pkg__",
        "//server:__subpackages__",
    ],
    deps = [
        "//server/context",
        "//server/dynamo/core",
        "//server/files/data",
        "//server/helpers",
        "//server/spaces",
        "//shared/context",
        "//shared/error",
        "//shared/feed",
        "//shared/helpers",
        "//shared/id",
        "//shared/schema",
    ],
)
