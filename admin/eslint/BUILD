load("@aspect_bazel_lib//lib:copy_to_bin.bzl", "copy_to_bin")
load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "eslint",
    deps = [
        "//client/web/content",
        "//shared/helpers",
        "//shared/id",
    ],
)

copy_to_bin(
    name = "eslint_test_file",
    srcs = ["eslint_test.cjs"],
    visibility = ["//visibility:public"],
)
