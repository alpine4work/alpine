load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "data",
    test_deps = [
        "//server/dynamo/test_helpers",
        "//server/messaging/test_helpers",
        "//server/spaces/test_helpers",
    ],
    visibility = [
        "//admin/dynamo:__pkg__",
        "//app:__pkg__",
        "//server/notifications/data:__pkg__",
        "//server/rpc:__pkg__",
        "//server/search/index:__pkg__",
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
