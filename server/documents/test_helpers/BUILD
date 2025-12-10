load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "test_helpers",
    visibility = [
        "//app/integration_tests:__subpackages__",
        "//server:__subpackages__",
    ],
    deps = [
        "//:node_modules/prosemirror-model",
        "//:node_modules/prosemirror-transform",
        "//server/access/test_helpers",
        "//server/documents/data",
        "//server/messaging/test_helpers",
        "//server/spaces/test_helpers",
        "//shared/documents",
        "//shared/helpers",
        "//shared/id",
        "//shared/messaging",
    ],
)
