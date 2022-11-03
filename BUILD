load("@npm//:defs.bzl", "npm_link_all_packages")
load("@aspect_rules_ts//ts:defs.bzl", "ts_config")

exports_files([
    "package.json",
    "prettier.config.js",
    ".prettierignore",
    ".eslintrc.js",
    ".eslintignore",
    "tsconfig.json",
])

npm_link_all_packages(name = "node_modules")

ts_config(
    name = "tsconfig",
    src = "tsconfig.json",
    visibility = [":__subpackages__"],
)
