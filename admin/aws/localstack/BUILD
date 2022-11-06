load("@aspect_rules_js//js:defs.bzl", "js_binary")
load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "localstack_lib",
    data = ["//admin/aws/localstack/background"],
    visibility = ["//app/dev:__pkg__"],
    deps = [
        "//:node_modules/@types/proper-lockfile",
        "//:node_modules/@types/yargs",
        "//:node_modules/fs-extra",
        "//:node_modules/proper-lockfile",
        "//:node_modules/tree-kill",
        "//:node_modules/yargs",
        "//admin",
    ],
)

js_binary(
    name = "localstack",
    data = [":localstack_lib"],
    entry_point = "localstack_main.js",
    # Always run in development mode. Tests that use LocalStack also run LocalStack
    # in development mode.
    env = {"NODE_ENV": "development"},
)
