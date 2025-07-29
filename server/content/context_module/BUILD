load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "context_module",
    test_deps = [
        "//server/documents/test_helpers",
        "//server/dynamo/test_helpers",
        "//server/files/test_helpers",
        "//server/forum/test_helpers",
        "//server/spaces/test_helpers",
        "//server/tasks/test_helpers",
        "//shared/test_helpers",
    ],
    tests = {
        "get_message_references_for_multiple_accounts_test": {"size": "medium"},
    },
    visibility = [
        "//app:__pkg__",
        "//server:__subpackages__",
    ],
    deps = [
        "//server/context",
        "//server/documents/data",
        "//server/forum/data",
        "//server/helpers",
        "//server/search/data/index",
        "//server/spaces",
        "//server/tasks/data",
        "//shared/context",
        "//shared/error",
        "//shared/files",
        "//shared/helpers",
        "//shared/id",
        "//shared/schema",
        "//shared/tasks",
    ],
)
