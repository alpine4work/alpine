load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "files",
    test_deps = [
        "//server/api/internal/test_helpers",
        "//server/bots/test_helpers",
        "//server/documents/test_helpers",
        "//server/dynamo/test_helpers",
        "//server/files/test_helpers",
        "//server/forum/test_helpers",
        "//server/spaces/test_helpers",
    ],
    visibility = ["//server/api:__subpackages__"],
    deps = [
        "//server/api/internal/shared",
        "//server/chat/data",
        "//server/documents/data",
        "//server/files/data",
        "//server/forum/data",
        "//server/helpers",
        "//server/tasks/data",
        "//shared/error",
        "//shared/files",
        "//shared/helpers",
        "//shared/id",
    ],
)
