load("@aspect_bazel_lib//lib:copy_to_bin.bzl", "copy_to_bin")
load("@npm//:@playwright/test/package_json.bzl", "bin")
load("//admin/typescript:typescript.bzl", "ts_lint_and_format_test")

exports_files([
    "playwright_test.sh",
    "playwright_test_show_trace.sh",
])

ts_lint_and_format_test(
    name = "playwright",
)

copy_to_bin(
    name = "playwright_setup_file",
    srcs = ["playwright_setup.mjs"],
    visibility = ["//visibility:public"],
)

bin.playwright_binary(
    name = "playwright_show_trace",
    args = ["show-trace"],
)
