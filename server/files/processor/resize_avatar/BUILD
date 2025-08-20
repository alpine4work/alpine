load("//admin/typescript:typescript.bzl", "ts_project")
load("//admin/aws/lambda:aws_lambda.bzl", "aws_lambda")
load("//admin/bazel:production_transition.bzl", "production_transition")

ts_project(
    name = "resize_avatar",
    visibility = [
        "//admin/aws:__subpackages__",
        "//admin/dev:__subpackages__",
        "//admin/lambda/local/file_processor_service:__subpackages__",
    ],
    deps = [
        "//:node_modules/sharp",
        "//server/files/data",
        "//server/files/processor/sharp",
        "//server/helpers",
        "//server/helpers/node",
        "//server/lambda",
        "//server/spaces",
        "//server/tokens",
        "//shared/avatar",
        "//shared/avatar/protocol",
        "//shared/error",
        "//shared/helpers",
        "//shared/id",
        "//shared/tracer",
    ],
)

# Lambda for file resizing (replaces ECS endpoint)
aws_lambda(
    name = "resize_avatar_lambda",
    srcs = [":resize_avatar"],
    entry_point = "resize_avatar_lambda.js",
    visibility = ["//admin/aws:__pkg__"],
)

production_transition(
    name = "resize_avatar_lambda_production",
    target = ":resize_avatar_lambda",
    visibility = ["//admin/aws:__pkg__"],
)
