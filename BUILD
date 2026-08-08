load("@npm//:defs.bzl", "npm_link_all_packages")
load("@aspect_bazel_lib//lib:copy_to_bin.bzl", "copy_to_bin")
load("@aspect_rules_ts//ts:defs.bzl", "ts_config")
load("@rules_python//python:pip.bzl", "compile_pip_requirements")
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
    "Package.swift",
    "pnpm-lock.yaml",
    "vite-env.d.ts",
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
    "cts",
    "mts",
    "mjs",
    "cjs",
    "json",
    "md",
    "yaml",
]

ROOT_LINT_AND_FORMAT_FOLDERS = [
    ".vscode",
    ".open_source.github",
]

ts_lint_and_format_test(
    name = "root",
    srcs = glob(
        ["*.open_source.{}".format(extension) for extension in ROOT_LINT_AND_FORMAT_EXTENSIONS] +
        ["{}/*.open_source*.open_source/*.open_source.{}".format(folder, extension) for extension in ROOT_LINT_AND_FORMAT_EXTENSIONS for folder in ROOT_LINT_AND_FORMAT_FOLDERS],
        allow_empty = True,
    ),
)

alias(
    name = "node",
    actual = select({
        "@bazel_tools//src/conditions:darwin_arm64": "@nodejs_darwin_arm64//:bin/node",
        "@bazel_tools//src/conditions:darwin_x86_64": "@nodejs_darwin_amd64//:bin/node",
        "@bazel_tools//src/conditions:linux_aarch64": "@nodejs_linux_arm64//:bin/node",
        "@bazel_tools//src/conditions:linux_x86_64": "@nodejs_linux_amd64//:bin/node",
    }),
    visibility = ["//visibility:public"],
)

alias(
    name = "python",
    actual = select({
        "@bazel_tools//src/conditions:darwin_arm64": "@python_aarch64-apple-darwin//:bin/python",
        "@bazel_tools//src/conditions:darwin_x86_64": "@python_x86_64-apple-darwin//:bin/python",
        "@bazel_tools//src/conditions:linux_aarch64": "@python_aarch64-unknown-linux-gnu//:bin/python",
        "@bazel_tools//src/conditions:linux_x86_64": "@python_x86_64-unknown-linux-gnu//:bin/python",
    }),
    visibility = ["//visibility:public"],
)

package_light_json(visibility = ["//visibility:public"])

copy_to_bin(
    name = "remix_config_files_copy_to_bin",
    srcs = [
        "tsconfig.json",
        "vite.config.mjs",
    ],
)

filegroup(
    name = "remix_config_files",
    srcs = [
        "//:env_files",
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
    name = "global_types_files",
    srcs = ["vite-env.d.ts"],
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
    srcs = glob(
        [".env*"],
        # Exclude local env files since they'll break remote caching given local env
        # files are different on different machines.
        exclude = [".env*.local"],
        # Environment files are optional in clean open-source worktrees.
        allow_empty = True,
    ),
    visibility = ["//visibility:public"],
)

copy_to_bin(
    name = "prettier_config_files_copy_to_bin",
    srcs = [
        ".prettierignore",
        "prettier.config.cjs",
    ],
)

filegroup(
    name = "prettier_config_files",
    srcs = [
        ":prettier_config_files_copy_to_bin",
        "//:node_modules/prettier-plugin-embed",
        "//:node_modules/prettier-plugin-sql",
        "//admin/prettier/plugin:prettier_estree_plugin_with_markdown_comments_copy_to_bin",
    ],
    visibility = ["//visibility:public"],
)

compile_pip_requirements(
    name = "requirements",
    src = "requirements.txt",
    requirements_txt = "requirements_lock.txt",
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

alias(
    name = "cmake",
    actual = select({
        "@bazel_tools//src/conditions:darwin_arm64": "@cmake_macos//:bin/cmake",
        "@bazel_tools//src/conditions:darwin_x86_64": "@cmake_macos//:bin/cmake",
        "@bazel_tools//src/conditions:linux_aarch64": "@cmake_linux_aarch64//:bin/cmake",
        "@bazel_tools//src/conditions:linux_x86_64": "@cmake_linux_x86_64//:bin/cmake",
    }),
    visibility = ["//visibility:public"],
)

# We use Zig's C compiler to build our C dependencies. This way we use a
# hermetic C compiler instead of whatever is on the developer's system. To
# learn more about using Zig as a drop-in C compiler read [`zig cc`: a Powerful
# Drop-In Replacement for GCC/Clang][1]. We learned about this technique from
# [uber/hermetic_cc_toolchain][2]. We don't use the rules maintained by Uber
# since we're not currently using Bazel's C toolchain support.
#
# [1]: https://andrewkelley.me/post/zig-cc-powerful-drop-in-replacement-gcc-clang.html
# [2]: https://github.com/uber/hermetic_cc_toolchain
alias(
    name = "zig",
    actual = select({
        "@bazel_tools//src/conditions:darwin_arm64": "@zig_macos_aarch64//:zig",
        "@bazel_tools//src/conditions:darwin_x86_64": "@zig_macos_x86_64//:zig",
        "@bazel_tools//src/conditions:linux_aarch64": "@zig_linux_aarch64//:zig",
        "@bazel_tools//src/conditions:linux_x86_64": "@zig_linux_x86_64//:zig",
    }),
    visibility = ["//visibility:public"],
)

alias(
    name = "emscripten",
    actual = select({
        "@bazel_tools//src/conditions:darwin_arm64": "@emscripten_bin_mac_arm64//:all",
        "@bazel_tools//src/conditions:darwin_x86_64": "@emscripten_bin_mac//:all",
        "@bazel_tools//src/conditions:linux_aarch64": "@emscripten_bin_linux//:all",
        "@bazel_tools//src/conditions:linux_x86_64": "@emscripten_bin_linux_arm64//:all",
    }),
    visibility = ["//visibility:public"],
)

alias(
    name = "wabt",
    actual = select({
        "@bazel_tools//src/conditions:darwin_arm64": "@wabt_macos_arm64//:all",
        "@bazel_tools//src/conditions:linux_aarch64": "@wabt_linux_arm64//:all",
        "@bazel_tools//src/conditions:linux_x86_64": "@wabt_linux_x64//:all",
    }),
    visibility = ["//visibility:public"],
)
