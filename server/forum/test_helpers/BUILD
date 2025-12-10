load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "test_helpers",
    visibility = [
        "//admin:__subpackages__",
        "//app/integration_tests:__subpackages__",
        "//server:__subpackages__",
    ],
    deps = [
        "//server/access/test_helpers",
        "//server/files/test_helpers",
        "//server/forum/data",
        "//server/messaging/test_helpers",
        "//server/spaces/test_helpers",
        "//shared/forum",
        "//shared/helpers",
        "//shared/id",
        "//shared/schema",
    ],
)
