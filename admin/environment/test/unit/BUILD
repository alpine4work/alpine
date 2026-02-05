load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "unit",
    visibility = [
        "//admin:__subpackages__",
        "//server/dynamo/test_helpers:__subpackages__",
    ],
    deps = [
        "//:node_modules/@types/fs-extra",
        "//:node_modules/@types/node",
        "//:node_modules/fs-extra",
        "//:node_modules/get-port",
        "//admin/dynamo/local",
        "//admin/helpers",
        "//admin/opensearch/local",
        "//admin/sqs/local",
        "//server/cloudflare/r2",
        "//server/context",
        "//server/dynamo/core",
        "//server/emails",
        "//server/helpers",
        "//server/jobs/core",
        "//server/opensearch",
        "//server/spaces/test_helpers",
        "//server/tokens",
        "//shared/context",
        "//shared/error",
        "//shared/helpers",
        "//shared/id",
        "//shared/schema",
        "//shared/tracer",
    ],
)
