load("//admin/typescript:typescript.bzl", "ts_project")
load("//admin/aws/lambda:aws_lambda.bzl", "aws_lambda")
load("//admin/bazel:production_transition.bzl", "production_transition")

ts_project(
    name = "send_alert",
    visibility = [
        "//admin/aws:__subpackages__",
    ],
    deps = [
        "//:node_modules/@types/aws-lambda",
        "//server/lambda",
        "//shared/api",
        "//shared/error",
        "//shared/id",
    ],
)

aws_lambda(
    name = "send_alert_lambda",
    srcs = [":send_alert"],
    entry_point = "send_alert_lambda.js",
    visibility = ["//admin/aws:__pkg__"],
)

production_transition(
    name = "send_alert_lambda_production",
    target = ":send_alert_lambda",
    visibility = ["//admin/aws:__pkg__"],
)
