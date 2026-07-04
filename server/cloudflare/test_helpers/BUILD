load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "test_helpers",
    testonly = True,
    visibility = [
        "//app/databases_test:__pkg__",
        "//server:__subpackages__",
    ],
    deps = [
        "//server/cloudflare",
        "//server/context",
        "//server/dynamo/test_helpers",
        "//server/helpers",
        "//server/rpc:rpc_testonly",
        "//shared/context",
        "//shared/helpers",
    ],
)
