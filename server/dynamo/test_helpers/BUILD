load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "test_helpers",
    visibility = [
        "//integration_tests:__subpackages__",
        "//server:__subpackages__",
    ],
    deps = [
        "//:node_modules/@types/jest",
        "//:node_modules/@types/node",
        "//:node_modules/@types/node-fetch",
        "//:node_modules/aws4fetch",
        "//:node_modules/fs-extra",
        "//:node_modules/get-port",
        "//:node_modules/node-fetch",
        "//admin/dynamo/local",
        "//admin/helpers",
        "//server/dynamo",
        "//shared/content",
        "//shared/context",
        "//shared/helpers",
        "//shared/models",
        "//shared/tracer",
    ],
)
