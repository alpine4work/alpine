load("@aspect_bazel_lib//lib:copy_to_bin.bzl", "copy_to_bin")
load("//admin/typescript:typescript.bzl", "ts_lint_and_format_test")

ts_lint_and_format_test(
    name = "jest",
)

copy_to_bin(
    name = "jest_config_files",
    srcs = glob([
        "**/*.js",
        "**/*.cjs",
        "**/*.mjs",
    ]),
    visibility = ["//visibility:public"],
)
