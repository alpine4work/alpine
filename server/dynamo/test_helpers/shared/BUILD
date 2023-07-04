load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "shared",
    testonly = True,
    visibility = [
        "//app/integration_tests:__pkg__",
        "//server:__subpackages__",
    ],
    deps = [
        "//:node_modules/@types/node",
        "//:node_modules/@types/node-fetch",
        "//:node_modules/aws4fetch",
        "//:node_modules/fs-extra",
        "//:node_modules/get-port",
        "//:node_modules/node-fetch",
        "//admin/dynamo/local",
        "//admin/helpers",
        "//server/cloudflare",
        "//server/dynamo",
        "//server/rpc",
        "//shared/context",
        "//shared/helpers",
        "//shared/tracer",
    ],
)
