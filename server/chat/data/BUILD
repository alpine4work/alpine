load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "data",
    test_deps = [
        "//server/bots/test_helpers",
        "//server/chat/test_helpers",
        "//server/dynamo/test_helpers",
        "//server/messaging/test_helpers/suite",
        "//server/spaces/test_helpers",
    ],
    tests = {
        "chat_actions_test": {"size": "medium"},
        "authorize_chat_access_test": {"size": "medium"},
    },
    visibility = [
        "//admin:__subpackages__",
        "//app:__pkg__",
        "//server:__subpackages__",
    ],
    deps = [
        "//:node_modules/murmurhash",
        "//server/access",
        "//server/content",
        "//server/context",
        "//server/dynamo/core",
        "//server/feed",
        "//server/files/data",
        "//server/helpers",
        "//server/messaging/helpers",
        "//server/notifications/core",
        "//server/search/data/table",
        "//server/spaces",
        "//shared/access",
        "//shared/chat",
        "//shared/error",
        "//shared/files",
        "//shared/helpers",
        "//shared/id",
        "//shared/messaging",
        "//shared/schema",
        "//shared/search",
    ],
)
