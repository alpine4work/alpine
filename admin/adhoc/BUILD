load("@aspect_rules_js//js:defs.bzl", "js_binary")
load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "adhoc_lib",
    tags = [
        # Ignored by `dev check` and `dev test`.
        "adhoc",
    ],
    deps = [
        "//:node_modules/@aws-sdk/credential-providers",
        "//:node_modules/@lume/kiwi",
        "//:node_modules/@types/color",
        "//:node_modules/@types/fs-extra",
        "//:node_modules/@types/node",
        "//:node_modules/aws4fetch",
        "//:node_modules/chalk",
        "//:node_modules/color",
        "//:node_modules/compromise",
        "//:node_modules/fs-extra",
        "//:node_modules/fuse.js",
        "//:node_modules/pretty-ms",
        "//:node_modules/sharp",
        "//admin/helpers",
        "//client/web/icons",
        "//client/web/rpc",
        "//server/apns",
        "//server/rpc",
        "//server/tracer",
        "//shared/content",
        "//shared/context",
        "//shared/design",
        "//shared/error",
        "//shared/files",
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
