load("@aspect_bazel_lib//lib:copy_to_bin.bzl", "copy_to_bin")
load("@aspect_rules_js//js:defs.bzl", "js_binary")
load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "lambda",
    deps = [
        "//:node_modules/@types/aws-lambda",
        "//:node_modules/@types/fs-extra",
        "//:node_modules/fs-extra",
        "//shared/error",
        "//shared/helpers",
    ],
)

js_binary(
    name = "aws_lambda_local_invoker",
    data = [":lambda"],
    entry_point = "aws_lambda_local_invoker_main.js",
    env = {"NODE_ENV": "development"},
)

copy_to_bin(
    name = "aws_lambda_esbuild_config_file",
    srcs = ["aws_lambda_esbuild_config.cjs"],
    visibility = ["//visibility:public"],
)
