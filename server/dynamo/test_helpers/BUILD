load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "test_helpers",
    testonly = True,
    visibility = [
        "//app/integration_tests:__pkg__",
        "//server:__subpackages__",
    ],
    deps = [
        "//:node_modules/@types/node",
        "//:node_modules/aws4fetch",
        "//:node_modules/fs-extra",
        "//:node_modules/get-port",
        "//admin/dynamo/local",
        "//admin/helpers",
        "//admin/opensearch/local",
        "//server/accounts",
        "//server/context",
        "//server/dynamo/core",
        "//server/notifications/core",
        "//server/opensearch",
        "//server/spaces",
        "//server/tracer",
        "//shared/context",
        "//shared/helpers",
        "//shared/tracer",
        "//shared/tracer/dev",
    ],
)
