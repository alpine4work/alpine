load("@aspect_rules_swc//swc:defs.bzl", "swc_transpiler")
load("@aspect_rules_ts//ts:defs.bzl", "ts_project")
load("//admin/bazel:helpers/ts_glob.bzl", "ts_glob")

ts_project(
    name = "admin",
    srcs = ts_glob(["**/*"]),
    declaration = True,
    resolve_json_module = True,
    transpiler = swc_transpiler,
    tsconfig = "//:tsconfig",
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
