load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "local",
    data = [
        ":java_path",
        "@bazel_tools//tools/jdk:current_java_runtime",
        "@dynamo_local//:DynamoDBLocal.jar",
        "@dynamo_local//:DynamoDBLocal_lib",
    ],
    visibility = [
        "//app/dev:__pkg__",
        "//server/dynamo/test_helpers:__subpackages__",
    ],
    deps = [
        "//:node_modules/aws4fetch",
        "//:node_modules/fs-extra",
        "//:node_modules/is-port-reachable",
        "//admin/helpers",
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
