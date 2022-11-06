load("@aspect_rules_js//js:defs.bzl", "js_binary")
load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "aws",
    visibility = [":__subpackages__"],
    deps = [
        "//:node_modules/aws-cdk-lib",
        "//:node_modules/constructs",
        "//:node_modules/fs-extra",
        "//admin",
        "//server",
        "//shared",
    ],
)

js_binary(
    name = "aws_synth",
    data = [":aws"],
    entry_point = "aws_synth_main.js",
)
