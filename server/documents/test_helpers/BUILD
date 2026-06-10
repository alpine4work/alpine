load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "test_helpers",
    visibility = [
        "//admin:__subpackages__",
        "//app/integration_tests:__subpackages__",
        "//app/screenshot_tests:__subpackages__",
        "//server:__subpackages__",
    ],
    deps = [
        "//:node_modules/prosemirror-model",
        "//:node_modules/prosemirror-transform",
        "//server/access/test_helpers",
        "//server/context",
        "//server/documents/data",
        "//server/messaging/test_helpers",
        "//server/spaces/test_helpers",
        "//shared/context",
        "//shared/documents",
        "//shared/helpers",
        "//shared/id",
        "//shared/messaging",
        "//shared/schema",
    ],
)
