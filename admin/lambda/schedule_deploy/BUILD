load("//admin/typescript:typescript.bzl", "ts_project")
load("//admin/aws/lambda:aws_lambda.bzl", "aws_lambda")
load("//admin/bazel:production_transition.bzl", "production_transition")

ts_project(
    name = "schedule_deploy",
    visibility = [
        "//admin/aws:__subpackages__",
    ],
    deps = [
        "//:node_modules/@aws-sdk/client-sqs",
        "//:node_modules/@types/aws-lambda",
        "//server/jobs/core",
        "//shared/error",
    ],
)

aws_lambda(
    name = "schedule_deploy_lambda",
    srcs = [":schedule_deploy"],
    entry_point = "schedule_deploy_lambda.js",
    visibility = ["//admin/aws:__pkg__"],
)

production_transition(
    name = "schedule_deploy_lambda_production",
    target = ":schedule_deploy_lambda",
    visibility = ["//admin/aws:__pkg__"],
)
