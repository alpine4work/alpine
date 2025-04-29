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
        "//server/access/test_helpers",
        "//server/dynamo/test_helpers",
        "//server/files/test_helpers",
        "//server/forum/test_helpers",
        "//server/messaging/test_helpers",
        "//server/spaces/test_helpers",
        "//server/spaces/add_account",
    ],
    visibility = [
        "//admin/crawl:__pkg__",
        "//app:__pkg__",
        "//server/alpha:__pkg__",
        "//server/files/entity:__pkg__",
        "//server/migration:__pkg__",
        "//server/notifications/data:__pkg__",
        "//server/rpc:__pkg__",
        "//server/search/data/index:__pkg__",
    ],
    deps = [
        "//server/access",
        "//server/content",
        "//server/context",
        "//server/dynamo/core",
        "//server/dynamo/core/general_realtime",
        "//server/files/data",
        "//server/messaging/helpers",
        "//server/notifications/core",
        "//server/search/data/table",
        "//server/spaces",
        "//shared/accounts",
        "//shared/context",
        "//shared/forum",
        "//shared/helpers",
        "//shared/id",
        "//shared/messaging",
        "//shared/schema",
    ],
)
