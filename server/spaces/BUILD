load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "spaces",
    test_deps = [
        "//server/bots/test_helpers",
        "//server/dynamo/test_helpers",
        "//server/forum/data",
        "//server/search/data/index",
        "//server/spaces/test_helpers",
        "//shared/spaces/test_helpers",
    ],
    tests = {
        "spaces_actions_test": {"size": "medium"},
    },
    visibility = [
        "//admin:__subpackages__",
        "//app:__pkg__",
        "//server:__subpackages__",
    ],
    deps = [
        "//:node_modules/fuse.js",
        "//server/accounts",
        "//server/bots",
        "//server/context",
        "//server/dynamo/core",
        "//server/emails",
        "//server/helpers",
        "//server/jobs/core",
        "//server/tokens",
        "//shared/accounts",
        "//shared/avatar",
        "//shared/context",
        "//shared/error:error_core",
        "//shared/helpers",
        "//shared/helpers:helpers_core",
        "//shared/id",
        "//shared/schema",
        "//shared/spaces",
    ],
)
