load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "test_helpers",
    testonly = True,
    visibility = ["//server:__subpackages__"],
    deps = [
        "//:node_modules/@types/jest",
        "//:node_modules/@types/node",
        "//server/cloudflare",
        "//server/cloudflare/test_helpers",
        "//server/documents/test_helpers",
        "//server/dynamo/test_helpers",
        "//server/messaging/helpers",
        "//server/messaging/realtime",
        "//server/messaging/test_helpers",
        "//server/rpc:rpc_testonly",
        "//shared/content",
        "//shared/context",
        "//shared/helpers",
        "//shared/test_helpers",
    ],
)
