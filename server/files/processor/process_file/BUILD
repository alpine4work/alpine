load("//admin/typescript:typescript.bzl", "ts_project")
load("//admin/aws/lambda:aws_lambda.bzl", "aws_lambda")
load("//admin/bazel:production_transition.bzl", "production_transition")

ts_project(
    name = "process_file",
    visibility = [
        "//admin/aws:__subpackages__",
        "//admin/dev:__subpackages__",
        "//admin/lambda/local/file_processor_service:__subpackages__",
    ],
    deps = [
        "//server/aws",
        "//server/context",
        "//server/files/processor:processor_lib",
        "//server/lambda",
        "//shared/error",
        "//shared/tracer",
    ],
)

# Lambda for file resizing (replaces ECS endpoint)
aws_lambda(
    name = "process_file_lambda",
    srcs = [":process_file"],
    entry_point = "process_file_lambda.js",
    visibility = ["//admin/aws:__pkg__"],
    base_image = "lambda_node22_libreoffice",
)

production_transition(
    name = "process_file_lambda_production",
    target = ":process_file_lambda",
    visibility = ["//admin/aws:__pkg__"],
)
