load("@npm//:defs.bzl", "npm_link_all_packages")
load("@aspect_bazel_lib//lib:copy_to_bin.bzl", "copy_to_bin")
load("@aspect_rules_ts//ts:defs.bzl", "ts_config")
load("@rules_python//python/entry_points:py_console_script_binary.bzl", "py_console_script_binary")
load("//admin/node:package_light_json.bzl", "package_light_json")
load("//admin/typescript:typescript.bzl", "ts_lint_and_format_test")

npm_link_all_packages(name = "node_modules")

exports_files([
    "package.json",
    "prettier.config.cjs",
    ".prettierignore",
    ".eslintrc.cjs",
    ".eslintignore",
    "tsconfig.json",
    "tsconfig.bazel.json",
    "remix.config.cjs",
    "Package.swift",
])

ts_config(
    name = "tsconfig",
    src = "tsconfig.bazel.json",
    visibility = ["//visibility:public"],
    deps = [
        "package_light_json_file",
        "tsconfig.json",
    ],
)

ROOT_LINT_AND_FORMAT_EXTENSIONS = [
    "js",
    "jsx",
    "ts",
    "tsx",
    "mjs",
    "cjs",
    "json",
    "md",
    "yaml",
]

ROOT_LINT_AND_FORMAT_FOLDERS = [
    ".vscode",
    ".github",
]

ts_lint_and_format_test(
    name = "root",
    srcs = glob(
        ["*.{}".format(extension) for extension in ROOT_LINT_AND_FORMAT_EXTENSIONS] +
        ["{}/**/*.{}".format(folder, extension) for extension in ROOT_LINT_AND_FORMAT_EXTENSIONS for folder in ROOT_LINT_AND_FORMAT_FOLDERS],
        allow_empty = True,
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

py_console_script_binary(
    name = "ttx",
    pkg = "@pypi//fonttools",
    visibility = ["//visibility:public"],
    deps = [
        "@pypi//brotli",
        "@pypi//zopfli",
    ],
)

package_light_json(visibility = ["//visibility:public"])

copy_to_bin(
    name = "remix_config_files_copy_to_bin",
    srcs = [
        "remix.config.cjs",
        "tsconfig.json",
    ],
)

filegroup(
    name = "remix_config_files",
    srcs = [
        "//:env_files",
        "//:node_modules/dotenv",
        "//:node_modules/fs-extra",
        "//:package_light_json_file",
        "//:remix_config_files_copy_to_bin",
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
    name = "eslint_config_files",
    srcs = [
        ".eslintignore",
        ".eslintrc.cjs",
    ],
    visibility = ["//visibility:public"],
)

copy_to_bin(
    name = "jest_config_file",
    srcs = ["jest.config.cjs"],
    visibility = ["//visibility:public"],
)

copy_to_bin(
    name = "playwright_config_file",
    srcs = ["playwright.config.cjs"],
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

copy_to_bin(
    name = "env_files",
    srcs = glob([".env*"]),
    visibility = ["//visibility:public"],
)
