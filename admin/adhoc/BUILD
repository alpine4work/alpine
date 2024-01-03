load("@aspect_rules_js//js:defs.bzl", "js_binary")
load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "adhoc_lib",
    deps = [
        "//:node_modules/@aws-sdk/credential-providers",
        "//:node_modules/@types/fs-extra",
        "//:node_modules/@types/node",
        "//:node_modules/aws4fetch",
        "//:node_modules/compromise",
        "//:node_modules/fs-extra",
        "//:node_modules/fuse.js",
        "//admin/helpers",
        "//client/rpc",
        "//server/rpc",
        "//server/tracer",
        "//shared/content",
        "//shared/context",
        "//shared/error",
        "//shared/helpers",
        "//shared/schema",
        "//shared/tracer",
    ],
)

js_binary(
    name = "adhoc",
    data = [":adhoc_lib"],
    entry_point = "adhoc_main.js",
    env = {"NODE_ENV": "development"},
)
