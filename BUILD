load("@npm//:defs.bzl", "npm_link_all_packages")
load("@aspect_rules_ts//ts:defs.bzl", "ts_config")
load("//admin/bazel:ts-project.bzl", "ts_lint_and_format_test")
load("//app:compiler/remix-compiler.bzl", "remix_compiler")

exports_files([
    "package.json",
    "prettier.config.js",
    ".prettierignore",
    ".eslintrc.js",
    ".eslintignore",
    "tsconfig.json",
    "remix.config.js",
])

npm_link_all_packages(name = "node_modules")

ts_config(
    name = "tsconfig",
    src = "tsconfig.json",
    visibility = [":__subpackages__"],
)

remix_compiler(
    name = "remix_app",
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
