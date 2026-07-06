load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "core",
    test_deps = ["//server/dynamo/test_helpers"],
    visibility = [
        "//admin:__subpackages__",
        "//app:__pkg__",
        "//server:__subpackages__",
    ],
    deps = [
        "//:node_modules/@aws-sdk/client-sqs",
        "//server/helpers",
        "//server/notifications/core",
        "//server/search/core",
        "//shared/api/specification",
        "//shared/context",
        "//shared/error",
        "//shared/feed",
        "//shared/helpers",
        "//shared/id",
        "//shared/notifications",
        "//shared/schema",
        "//shared/tracer",
    ],
)
