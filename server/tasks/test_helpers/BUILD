load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "test_helpers",
    visibility = [
        "//admin:__subpackages__",
        "//app/integration_tests:__subpackages__",
        "//server:__subpackages__",
    ],
    deps = [
        "//:node_modules/prosemirror-model",
        "//:node_modules/prosemirror-transform",
        "//:node_modules/y-prosemirror",
        "//:node_modules/yjs",
        "//server/access",
        "//server/access/test_helpers",
        "//server/messaging/test_helpers",
        "//server/spaces/test_helpers",
        "//server/tasks/data",
        "//shared/helpers",
        "//shared/id",
    ],
)
