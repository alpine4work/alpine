load("@aspect_rules_js//js:defs.bzl", "js_binary")
load("@pypi//:requirements.bzl", "requirement")
load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "background_lib",
    data = [
        ":localstack_cli",
        "//:cdk.context.json",
        "//:cdk.json",
    ],
    deps = [
        "//:node_modules/aws-cdk-local",
        "//:node_modules/is-port-reachable",
        "//:node_modules/strip-ansi",
        "//admin",
        "//admin/aws",
        "//server",
    ],
)

js_binary(
    name = "background",
    data = [":background_lib"],
    entry_point = "localstack_background_main.js",
    # Always run in development mode. Tests that use LocalStack also run LocalStack
    # in development mode.
    env = {"NODE_ENV": "development"},
    visibility = ["//admin/aws/localstack:__pkg__"],
)

# We name this target `localstack_cli` instead of `localstack` because then a
# `localstack.py` file would be required which would override our
# `localstack` dependency.
py_binary(
    name = "localstack_cli",
    srcs = ["localstack_cli.py"],
    deps = [requirement("localstack")],
)
