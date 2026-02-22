load("//admin/typescript:typescript.bzl", "ts_project")
load("//admin/aws/lambda:aws_lambda.bzl", "aws_lambda")
load("//admin/bazel:production_transition.bzl", "production_transition")

ts_project(
    name = "analytics_mirror_export",
    visibility = ["//admin/aws:__pkg__"],
    deps = [
        "//server/lambda",
        "//shared/error",
        "//shared/helpers",
        "//:node_modules/@aws-sdk/client-dynamodb",
        "//:node_modules/@aws-sdk/client-s3",
        "//:node_modules/@types/aws-lambda",
    ],
)

aws_lambda(
    name = "transform_analytics_mirror_export_lambda",
    srcs = [":analytics_mirror_export"],
    entry_point = "transform_analytics_mirror_export_lambda.js",
    visibility = ["//admin/aws:__pkg__"],
)

production_transition(
    name = "transform_analytics_mirror_export_lambda_production",
    target = ":transform_analytics_mirror_export_lambda",
    visibility = ["//admin/aws:__pkg__"],
)

aws_lambda(
    name = "trigger_analytics_mirror_export_lambda",
    srcs = [":analytics_mirror_export"],
    entry_point = "trigger_analytics_mirror_export_lambda.js",
    visibility = ["//admin/aws:__pkg__"],
)

production_transition(
    name = "trigger_analytics_mirror_export_lambda_production",
    target = ":trigger_analytics_mirror_export_lambda",
    visibility = ["//admin/aws:__pkg__"],
)
