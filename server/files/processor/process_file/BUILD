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
