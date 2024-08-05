load("@aspect_rules_js//js:defs.bzl", "js_binary")
load("//admin/typescript:typescript.bzl", "ts_project")

js_binary(
    name = "tool",
    data = [":tool_lib"],
    entry_point = "deploy_service.js",
    env = {"NODE_ENV": "production"},
)

ts_project(
    name = "tool_lib",
    deps = [
        "//:node_modules/@types/fs-extra",
        "//:node_modules/@types/node",
        "//:node_modules/env-paths",
        "//:node_modules/fs-extra",
        "//server/deploy/data",
        "//server/helpers/node",
        "//server/node",
        "//shared/context",
        "//shared/error",
        "//shared/helpers",
        "//shared/id",
        "//shared/schema",
        "//shared/tracer",
    ],
)
