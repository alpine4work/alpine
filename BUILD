load("@npm//:defs.bzl", "npm_link_all_packages")
load("@aspect_bazel_lib//lib:copy_to_bin.bzl", "copy_to_bin")
load("@aspect_rules_ts//ts:defs.bzl", "ts_config")
load("//admin/typescript:typescript.bzl", "ts_lint_and_format_test")

npm_link_all_packages(name = "node_modules")

exports_files([
    "package.json",
    "prettier.config.js",
    ".prettierignore",
    ".eslintrc.js",
    ".eslintignore",
    "tsconfig.json",
    "tsconfig.bazel.json",
    "remix.config.js",
])

ts_config(
    name = "tsconfig",
    src = "tsconfig.bazel.json",
    visibility = ["//visibility:public"],
    deps = ["tsconfig.json"],
)

ts_lint_and_format_test(
    name = "root",
    srcs = glob(
        [
            "**/*.js",
            "**/*.jsx",
            "**/*.ts",
            "**/*.tsx",
            "**/*.mjs",
            "**/*.json",
            "**/*.md",
        ],
        exclude = [
            "node_modules",
            "bazel-*/**/*",
            "public/**/*",
            "functions/**/*",
            ".cache/**/*",
            ".local/**/*",
        ],
    ),
)

alias(
    name = "node",
    actual = select({
        "@bazel_tools//src/conditions:darwin_arm64": "@node_darwin_arm64//:bin/node",
        "@bazel_tools//src/conditions:darwin_x86_64": "@node_darwin_amd64//:bin/node",
        "@bazel_tools//src/conditions:linux_x86_64": "@node_linux_amd64//:bin/node",
        "@bazel_tools//src/conditions:linux_s390x": "@node_linux_s390x//:bin/node",
        "@bazel_tools//src/conditions:linux_ppc64le": "@node_linux_ppc64le//:bin/node",
        "@bazel_tools//src/conditions:windows": "@node_windows_amd64//:bin/node",
    }),
    visibility = ["//visibility:public"],
)

copy_to_bin(
    name = "remix_config_files",
    srcs = [
        "package.json",
        "remix.config.js",
        "tsconfig.json",
    ],
    visibility = ["//visibility:public"],
)

copy_to_bin(
    name = "tsconfig_files",
    srcs = [
        "tsconfig.bazel.json",
        "tsconfig.json",
    ],
    visibility = ["//visibility:public"],
)

copy_to_bin(
    name = "jest_config_file",
    srcs = ["jest.config.js"],
    visibility = ["//visibility:public"],
)

copy_to_bin(
    name = "playwright_config_file",
    srcs = ["playwright.config.js"],
    visibility = ["//visibility:public"],
)

copy_to_bin(
    name = "cdk_files",
    srcs = [
        "cdk.context.json",
        "cdk.json",
    ],
    visibility = ["//visibility:public"],
)

filegroup(
    name = "env_files",
    srcs = glob([".env*"]),
    visibility = ["//visibility:public"],
)
