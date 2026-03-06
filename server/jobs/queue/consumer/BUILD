load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "consumer",
    test_deps = ["//server/dynamo/test_helpers"],
    tests = {
        "job_queue_consumer_test": {"size": "medium"},
    },
    visibility = [
        "//server/files/processor:__pkg__",
        "//server/jobs/queue:__pkg__",
        "//admin/lambda/local:__pkg__",
    ],
    deps = [
        "//:node_modules/@aws-sdk/client-sqs",
        "//server/accounts",
        "//server/context",
        "//server/helpers",
        "//server/jobs/core",
        "//shared/context",
        "//shared/error",
        "//shared/helpers",
        "//shared/tracer",
    ],
)
