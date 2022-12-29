load("@aspect_rules_js//js:defs.bzl", "js_binary")
load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "dynamo",
    data = ["dynamo_local"],
    deps = [
        "//:node_modules/fs-extra",
        "//admin/helpers",
        "//server/dynamo",
        "//shared/error",
    ],
)

sh_binary(
    name = "dynamo_local",
    srcs = ["dynamo_local.sh"],
    data = [
        "@bazel_tools//tools/jdk:current_java_runtime",
        "@dynamo_local//:DynamoDBLocal.jar",
        "@dynamo_local//:DynamoDBLocal_lib",
    ],
    env = {"JAVA": "$(JAVA)"},
    toolchains = ["@bazel_tools//tools/jdk:current_java_runtime"],
)

js_binary(
    name = "generate_dynamo_local_create_table_commands",
    data = [":dynamo"],
    entry_point = "scripts/generate_dynamo_local_create_table_commands_main.js",
    env = {"NODE_ENV": "development"},
)
