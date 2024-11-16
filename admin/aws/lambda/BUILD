load("@aspect_bazel_lib//lib:copy_to_bin.bzl", "copy_to_bin")

exports_files(["aws_lambda_noop.sh"])

copy_to_bin(
    name = "aws_lambda_esbuild_config_file",
    srcs = ["aws_lambda_esbuild_config.cjs"],
    visibility = ["//visibility:public"],
)
