load("//admin/aws/lambda:aws_lambda.bzl", "aws_lambda")
load("//admin/typescript:typescript.bzl", "ts_project")
load("//admin/bazel:production_transition.bzl", "production_transition")

ts_project(
    name = "dashboard_proxy_lib",
    deps = [
        "//:node_modules/@aws-sdk/credential-provider-node",
        "//:node_modules/@smithy/hash-node",
        "//:node_modules/@smithy/node-http-handler",
        "//:node_modules/@smithy/protocol-http",
        "//:node_modules/@smithy/signature-v4",
        "//:node_modules/@types/aws-lambda",
        "//shared/error",
        "//shared/helpers",
    ],
)

aws_lambda(
    name = "dashboard_proxy",
    srcs = [":dashboard_proxy_lib"],
    entry_point = "opensearch_dashboard_proxy_lambda.js",
)

production_transition(
    name = "dashboard_proxy_production",
    target = ":dashboard_proxy",
    visibility = ["//admin/aws:__pkg__"],
)
