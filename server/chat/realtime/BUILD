load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "realtime",
    test_deps = [
        "//server/dynamo/test_helpers",
        "//server/messaging/realtime/test_helpers",
        "//server/rpc:rpc_testonly",
    ],
    visibility = ["//server/edge:__subpackages__"],
    deps = [
        "//server/cloudflare",
        "//server/messaging/realtime",
        "//shared/chat",
        "//shared/error",
        "//shared/helpers",
        "//shared/id",
        "//shared/schema",
    ],
)
