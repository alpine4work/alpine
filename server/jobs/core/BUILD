load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "core",
    test_deps = ["//server/dynamo/test_helpers"],
    visibility = [
        "//admin/aws:__pkg__",
        "//admin/cron:__pkg__",
        "//admin/lambda/schedule_deploy:__pkg__",
        "//app:__pkg__",
        "//server:__subpackages__",
    ],
    deps = [
        "//:node_modules/@aws-sdk/client-sqs",
        "//server/helpers",
        "//server/notifications/core",
        "//server/search/core",
        "//shared/api",
        "//shared/context",
        "//shared/error",
        "//shared/feed",
        "//shared/helpers",
        "//shared/notifications",
        "//shared/schema",
        "//shared/tracer",
    ],
)
