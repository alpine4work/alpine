load("//admin/aws/lambda:aws_lambda.bzl", "aws_lambda")
load("//admin/typescript:typescript.bzl", "ts_project")
load("//admin/bazel:production_transition.bzl", "production_transition")

ts_project(
    name = "upload_lib",
    deps = [
        "//:node_modules/@types/aws-lambda",
        "//:node_modules/sharp",
        "//server/helpers/node",
        "//shared/error",
        "//shared/helpers",
    ],
)

aws_lambda(
    name = "upload",
    srcs = [":upload_lib"],
    entry_point = "file_upload_lambda.js",
    # `sharp` contains native modules so can't be bundled.
    external_deps = ["//:node_modules/sharp"],
)

production_transition(
    name = "deploy_production",
    src = ":deploy",
    visibility = ["//admin/aws:__pkg__"],
)
