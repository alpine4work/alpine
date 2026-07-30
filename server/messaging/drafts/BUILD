load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "drafts",
    test_deps = [
        "//:node_modules/@jest/globals",
        "//server/chat/data",
        "//server/documents/test_helpers",
        "//server/dynamo/test_helpers",
        "//server/forum/test_helpers",
        "//server/spaces/test_helpers",
        "//server/tasks/data/test_helpers",
    ],
    visibility = [
        "//admin:__subpackages__",
        "//app:__subpackages__",
        "//server:__subpackages__",
    ],
    deps = [
        "//server/chat/data",
        "//server/content",
        "//server/context",
        "//server/documents/data",
        "//server/dynamo/core",
        "//server/files/data",
        "//server/forum/data",
        "//server/helpers",
        "//server/spaces",
        "//server/tasks/data",
        "//shared/content",
        "//shared/error",
        "//shared/files",
        "//shared/helpers",
        "//shared/id",
        "//shared/messaging",
        "//shared/schema",
    ],
)
