load("//admin/aws/lambda:aws_lambda.bzl", "aws_lambda")
load("//admin/typescript:typescript.bzl", "ts_project")
load("//admin/bazel:production_transition.bzl", "production_transition")

ts_project(
    name = "deploy_lib",
    deps = [
        "//:node_modules/@types/aws-lambda",
        "//server/opensearch",
        "//server/search/data/index",
        "//server/tasks/data",
        "//server/tracer",
        "//shared/error",
        "//shared/helpers",
    ],
)

aws_lambda(
    name = "deploy",
    srcs = [":deploy_lib"],
    entry_point = "opensearch_deploy_lambda.js",
)

production_transition(
    name = "deploy_production",
    src = ":deploy",
    visibility = ["//admin/aws:__pkg__"],
)
