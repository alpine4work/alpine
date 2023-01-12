load("@aspect_rules_js//js:defs.bzl", "js_binary")
load("@npm//:aws-cdk/package_json.bzl", cdk_bin = "bin")
load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "aws",
    visibility = ["//app/dev:__pkg__"],
    deps = [
        "//:node_modules/aws-cdk-lib",
        "//:node_modules/chalk",
        "//:node_modules/constructs",
        "//:node_modules/fs-extra",
        "//:node_modules/pretty-ms",
        "//admin/helpers",
        "//server/dynamo",
    ],
)

js_binary(
    name = "aws_synth",
    data = [":aws"],
    entry_point = "aws_synth_main.js",
    env = {"NODE_ENV": "development"},
)

cdk_bin.cdk_binary(
    name = "cdk",
    data = [
        ":aws",
        "//:cdk_files",
    ],
    env = {
        "NODE_ENV": "development",
    },
)
