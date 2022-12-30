load("@aspect_rules_js//js:defs.bzl", "js_binary", "js_run_binary")
load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "dynamo",
    data = [
        ":java_path",
        "@bazel_tools//tools/jdk:current_java_runtime",
        "@dynamo_local//:DynamoDBLocal.jar",
        "@dynamo_local//:DynamoDBLocal_lib",
    ],
    visibility = ["//server/dynamo/test:__pkg__"],
    deps = [
        "//:node_modules/aws4fetch",
        "//:node_modules/fs-extra",
        "//:node_modules/get-port",
        "//:node_modules/is-port-reachable",
        "//admin/helpers",
        "//server/dynamo",
        "//shared/error",
        "//shared/helpers",
    ],
)

genrule(
    name = "java_path",
    outs = ["java_path.txt"],
    cmd = "echo $(JAVA) > $@",
    toolchains = ["@bazel_tools//tools/jdk:current_java_runtime"],
)

js_binary(
    name = "create_dynamo_local_base_data",
    data = [":dynamo"],
    entry_point = "create_dynamo_local_base_data_main.js",
    env = {"NODE_ENV": "development"},
)

js_run_binary(
    name = "dynamo_local_base_data",
    outs = ["dynamo_local_base_data/local_us-east-1.db"],
    args = ["dynamo_local_base_data"],
    chdir = package_name(),
    tool = "create_dynamo_local_base_data",
    visibility = ["//server/dynamo/test:__pkg__"],
)
