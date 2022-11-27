load("@aspect_rules_js//js:defs.bzl", "js_binary")
load("@npm//:aws-cdk-local/package_json.bzl", cdk_local_bin = "bin")
load("@npm//:aws-cdk/package_json.bzl", ck_production_bin = "bin")
load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "aws",
    visibility = ["//app/dev:__pkg__"],
    deps = [
        "//:node_modules/aws-cdk-lib",
        "//:node_modules/aws-cdk-local",
        "//:node_modules/constructs",
        "//:node_modules/fs-extra",
        "//admin",
        "//server",
        "//shared",
    ],
)

js_binary(
    name = "aws_synth",
    data = [":aws"],
    entry_point = "aws_synth_main.js",
    env = {"NODE_ENV": "development"},
)

cdk_local_bin.cdklocal_binary(
    name = "cdk_local",
    data = [
        ":aws",
        "//:cdk_files",
    ],
    env = {
        "NODE_ENV": "development",
        "LOCALSTACK_HOSTNAME": "127.0.0.1",
    },
)

ck_production_bin.cdk_binary(
    name = "cdk_production",
    data = [
        ":aws",
        "//:cdk_files",
    ],
    env = {
        "NODE_ENV": "development",
    },
)
