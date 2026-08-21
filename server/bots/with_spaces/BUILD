load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "with_spaces",
    test_deps = [
        "//server/bots/test_helpers",
        "//server/dynamo/test_helpers",
        "//server/spaces/test_helpers",
    ],
    visibility = [
        "//app:__pkg__",
        "//server:__subpackages__",
    ],
    deps = [
        "//server/accounts",
        "//server/bots",
        "//server/context",
        "//server/jobs/core",
        "//server/spaces",
        "//server/tokens",
        "//shared/bots",
        "//shared/bots/owners",
        "//shared/chat",
        "//shared/error",
        "//shared/helpers",
        "//shared/id",
    ],
)
