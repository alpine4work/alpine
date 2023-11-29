load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "data",
    test_deps = [
        "//server/dynamo/test_helpers",
        "//server/messaging/test_helpers",
    ],
    tests = {
        "documents_table_test": {"size": "medium"},
        "documents_table_slow_test": {"size": "medium"},
    },
    visibility = [
        "//admin/dynamo:__pkg__",
        "//app:__pkg__",
        "//server/notifications/data:__pkg__",
        "//server/rpc:__pkg__",
        "//server/search/data:__pkg__",
    ],
    deps = [
        "//:node_modules/date-fns",
        "//:node_modules/prosemirror-model",
        "//:node_modules/prosemirror-transform",
        "//server/content",
        "//server/context",
        "//server/dynamo/core",
        "//server/helpers",
        "//server/messaging/helpers",
        "//server/notifications/core",
        "//server/spaces",
        "//shared/context",
        "//shared/documents",
        "//shared/error",
        "//shared/helpers",
        "//shared/id",
        "//shared/messaging",
        "//shared/prosemirror",
        "//shared/schema",
    ],
)
