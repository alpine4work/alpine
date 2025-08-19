load("//admin/typescript:typescript.bzl", "ts_project")
load("//admin/aws/lambda:aws_lambda.bzl", "aws_lambda")
load("//admin/bazel:production_transition.bzl", "production_transition")

ts_project(
    name = "resize_file",
    visibility = [
        "//admin/dev:__subpackages__",
        "//admin/lambda/local/file_processor_service:__subpackages__"
    ],
    deps = [
        "//server/files/processor:processor_lib",
        "//server/lambda",
        "//server/spaces",
        "//server/tokens",
        "//shared/error",
        "//shared/id",
        "//shared/tracer",
    ],
)

# Lambda for file resizing (replaces ECS endpoint)
aws_lambda(
    name = "resize_file_lambda",
    srcs = [":resize_file"],
    entry_point = "resize_file_lambda.js",
    visibility = ["//admin/aws:__pkg__"],
)

production_transition(
    name = "resize_file_lambda_production",
    target = ":resize_file_lambda",
    visibility = ["//admin/aws:__pkg__"],
)

