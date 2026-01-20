load("//admin/aws/lambda:aws_lambda_deprecated.bzl", "aws_lambda_deprecated")
load("//admin/typescript:typescript.bzl", "ts_project")
load("//admin/bazel:production_transition.bzl", "production_transition")

ts_project(
    name = "deploy_script_lib",
    deps = [
        "//:node_modules/@types/aws-lambda",
        "//server/lambda",
        "//server/opensearch",
        "//server/search/data/index",
        "//server/tasks/data",
        "//server/tracer",
        "//shared/error",
        "//shared/helpers",
    ],
)

aws_lambda_deprecated(
    name = "deploy_script",
    srcs = [":deploy_script_lib"],
    entry_point = "opensearch_deploy_script_lambda.js",
)

production_transition(
    name = "deploy_script_production",
    target = ":deploy_script",
    visibility = ["//admin/aws:__pkg__"],
)
