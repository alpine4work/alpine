load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "test_helpers",
    testonly = True,
    visibility = ["//server/notifications/data:__pkg__"],
    deps = [
        "//server/accounts",
        "//server/apns",
        "//server/chat/test_helpers",
        "//server/context",
        "//server/documents/test_helpers",
        "//server/dynamo/test_helpers",
        "//server/forum/test_helpers",
        "//server/messaging/test_helpers",
        "//server/notifications/data",
        "//server/spaces",
        "//server/spaces/test_helpers",
        "//server/tasks/data/test_helpers",
        "//shared/accounts",
        "//shared/dynamo",
        "//shared/helpers",
        "//shared/id",
        "//shared/messaging",
        "//shared/notifications",
    ],
)
