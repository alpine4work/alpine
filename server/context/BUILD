load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "context",
    test_deps = ["//server/dynamo/test_helpers"],
    visibility = [
        "//admin/dynamo:__pkg__",
        "//app:__pkg__",
        "//server:__subpackages__",
    ],
    deps = [
        "//:node_modules/@aws-sdk/credential-providers",
        "//:node_modules/@smithy/types",
        "//:node_modules/aws4fetch",
        "//server/accounts",
        "//server/dynamo/core",
        "//server/emails",
        "//server/jobs/core",
        "//server/opensearch",
        "//shared/context",
        "//shared/helpers",
        "//shared/id",
        "//shared/tracer",
    ],
)
