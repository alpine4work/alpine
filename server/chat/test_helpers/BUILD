load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "test_helpers",
    visibility = [
        "//app/integration_tests:__subpackages__",
        "//server:__subpackages__",
    ],
    deps = [
        "//server/chat/data",
        "//server/files/test_helpers",
        "//server/messaging/test_helpers",
        "//server/spaces/test_helpers",
        "//shared/chat",
        "//shared/helpers",
        "//shared/id",
        "//shared/schema",
    ],
)
