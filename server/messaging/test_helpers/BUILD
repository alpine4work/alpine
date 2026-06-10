load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "test_helpers",
    visibility = [
        "//admin:__subpackages__",
        "//server:__subpackages__",
    ],
    deps = [
        "//shared/api/content",
        "//server/bots/test_helpers",
        "//server/files/test_helpers",
        "//server/integrations",
        "//server/messaging/helpers",
        "//shared/content",
        "//shared/context",
        "//shared/helpers",
    ],
)
