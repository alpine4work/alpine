load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "feed",
    test_deps = [
        "//server/bots/test_helpers",
        "//server/chat/test_helpers",
        "//server/documents/test_helpers",
        "//server/dynamo/test_helpers",
        "//server/forum/test_helpers",
        "//server/sites/test_helpers",
        "//server/tasks/test_helpers",
    ],
    tests = {
        "feed_actions_test": {"size": "medium"},
        "feed_actions_slow_test": {"size": "medium"},
    },
    visibility = [
        "//admin/crawl:__pkg__",
        "//admin/dynamo:__pkg__",
        "//app:__pkg__",
        "//app/integration_tests:__pkg__",
        "//server:__subpackages__",
    ],
    deps = [
        "//server/context",
        "//server/dynamo/core",
        "//server/files/data",
        "//server/helpers",
        "//server/search/data/table",
        "//server/spaces",
        "//shared/context",
        "//shared/error",
        "//shared/feed",
        "//shared/helpers",
        "//shared/id",
        "//shared/schema",
    ],
)
