load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "integrations",
    test_deps = [
        "//server/bots/test_helpers",
        "//server/dynamo/test_helpers",
        "//server/spaces/test_helpers",
    ],
    visibility = [
        "//admin:__subpackages__",
        "//app:__pkg__",
        "//server:__subpackages__",
    ],
    deps = [
        "//:node_modules/@slack/web-api",
        "//server/accounts",
        "//server/context",
        "//server/dynamo/core",
        "//server/spaces",
        "//shared/context",
        "//shared/error",
        "//shared/helpers",
        "//shared/id",
        "//shared/integrations",
        "//shared/schema",
    ],
)
