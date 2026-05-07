load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "entity_actions",
    test_deps = [
        "//server/chat/test_helpers",
        "//server/dynamo/test_helpers",
        "//server/forum/test_helpers",
        "//server/sites/test_helpers",
        "//server/spaces/test_helpers",
        "//server/tasks/test_helpers",
        "//shared/access",
        "//shared/access/model",
        "//shared/search",
    ],
    visibility = [
        "//server/rpc:__subpackages__",
        "//server/sites/test_helpers:__pkg__",
    ],
    deps = [
        "//:node_modules/prosemirror-transform",
        "//server/chat/data",
        "//server/context",
        "//server/forum/data",
        "//server/sites/data",
        "//server/tasks/data",
        "//shared/documents",
        "//shared/dynamo",
        "//shared/helpers",
        "//shared/id",
        "//shared/sites",
    ],
)
