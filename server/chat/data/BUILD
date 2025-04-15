load("//admin/typescript:typescript.bzl", "ts_project")

alias(
    name = "data_testonly",
    testonly = True,
    actual = ":data",
    visibility = [
        "//server:__subpackages__",
    ],
)

ts_project(
    name = "data",
    test_deps = [
        "//server/chat/test_helpers",
        "//server/dynamo/test_helpers",
        "//server/messaging/test_helpers",
        "//server/spaces/test_helpers",
    ],
    tests = {
        "chat_table_test": {"size": "medium"},
    },
    visibility = [
        "//admin/crawl:__pkg__",
        "//app:__pkg__",
        "//server/migration:__pkg__",
        "//server/notifications/data:__pkg__",
        "//server/rpc:__pkg__",
        "//server/search/data/index:__pkg__",
    ],
    deps = [
        "//:node_modules/date-fns",
        "//:node_modules/murmurhash",
        "//server/accounts",
        "//server/content",
        "//server/context",
        "//server/dynamo/core",
        "//server/helpers",
        "//server/messaging/helpers",
        "//server/notifications/core",
        "//server/search/data/table",
        "//server/spaces",
        "//shared/accounts",
        "//shared/chat",
        "//shared/error",
        "//shared/helpers",
        "//shared/id",
        "//shared/messaging",
        "//shared/schema",
    ],
)
