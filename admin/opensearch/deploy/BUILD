load("//admin/aws:aws_lambda.bzl", "aws_lambda")
load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "deploy_lib",
    deps = [
        "//:node_modules/@types/aws-lambda",
        "//server/opensearch",
        "//server/tasks/data",
        "//server/tracer",
        "//shared/error",
        "//shared/helpers",
    ],
)

aws_lambda(
    name = "deploy",
    srcs = [":deploy_lib"],
    entry_point = "opensearch_deploy_script.js",
    visibility = ["//admin/aws:__pkg__"],
)
