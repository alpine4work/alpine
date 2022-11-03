load("//admin/bazel:ts-project.bzl", "ts_project")

ts_project(
    name = "admin",
    deps = [
        "//:node_modules/@juggle/resize-observer",
        "//:node_modules/@types/fs-extra",
        "//:node_modules/@types/node",
        "//:node_modules/@types/node-fetch",
        "//:node_modules/@vanilla-extract/esbuild-plugin",
        "//:node_modules/aws-cdk-lib",
        "//:node_modules/chalk",
        "//:node_modules/constructs",
        "//:node_modules/esbuild",
        "//:node_modules/fs-extra",
        "//:node_modules/node-fetch",
        "//:node_modules/pretty-ms",
        "//:node_modules/strip-ansi",
        "//server",
        "//shared",
    ],
)

filegroup(
    name = "eslint_custom_rules",
    srcs = glob(["eslint/rules/*.js"]),
    visibility = ["//visibility:public"],
)
