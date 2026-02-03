load("@aspect_rules_js//npm:defs.bzl", "npm_package")
load("//admin/typescript:typescript.bzl", "ts_lint_and_format_test")

ts_lint_and_format_test(
    name = "rules",
)

npm_package(
    name = "pkg",
    srcs = ["package.json"] + glob(["*.js"]),
    visibility = ["//visibility:public"],
)
