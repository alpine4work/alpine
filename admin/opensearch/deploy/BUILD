load("@aspect_rules_esbuild//esbuild:defs.bzl", "esbuild")
load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "deploy",
    deps = [
        "//:node_modules/@types/aws-lambda",
        "//server/opensearch",
        "//server/tasks/data",
        "//server/tracer",
        "//shared/error",
        "//shared/helpers",
    ],
)

esbuild(
    name = "deploy_lambda_directory",
    srcs = [":deploy"],
    define = {"process.env.NODE_ENV": "\"production\""},
    entry_point = "opensearch_deploy_script.js",
    # AWS SDK modules are available in Node.js 18 Lambda runtime.
    external = ["@aws-sdk/*"],
    format = "esm",
    output = "opensearch_deploy_script_lambda/index.mjs",
    platform = "node",
    splitting = False,
    target = "node18",
    visibility = ["//admin/aws:__pkg__"],
)
