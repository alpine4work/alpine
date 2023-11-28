load("//admin/typescript:typescript.bzl", "ts_project")

alias(
    name = "data_testonly",
    testonly = True,
    actual = ":data",
    visibility = [
        "//server/forum:__subpackages__",
    ],
)

ts_project(
    name = "data",
    test_deps = [
        "//server/dynamo/test_helpers",
        "//server/messaging/test_helpers",
    ],
    visibility = [
        "//admin/dynamo:__pkg__",
        "//app:__pkg__",
        "//server/notifications/data:__pkg__",
        "//server/rpc:__pkg__",
        "//server/search/data:__pkg__",
    ],
    deps = [
        "//server/content",
        "//server/context",
        "//server/dynamo/core",
        "//server/messaging/helpers",
        "//server/notifications/core",
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
