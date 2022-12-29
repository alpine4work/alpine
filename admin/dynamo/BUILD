load("@aspect_rules_js//js:defs.bzl", "js_binary")
load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "dynamo",
    data = ["dynamo_local"],
    deps = [
        "//:node_modules/fs-extra",
        "//admin",
        "//server",
        "//shared",
    ],
)

sh_binary(
    name = "dynamo_local",
    srcs = ["dynamo_local.sh"],
    data = [
        "@bazel_tools//tools/jdk:remotejdk_17",
        "@dynamo_local//:DynamoDBLocal.jar",
        "@dynamo_local//:DynamoDBLocal_lib",
    ],
    env = {"JAVA": "$(JAVA)"},
    # TODO(calebmer): It's unclear to me why `@bazel_tools//tools/jdk:current_java_runtime`
    # is giving me errors here. Also the [documentation says][1] putting a Java
    # toolchain here is reserved for "language experts" so this probably isn't the
    # easiest way to do this? Eventually someone will figure out the right way to
    # do this. I believe in you.
    #
    # [1]: https://bazel.build/reference/be/make-variables#predefined_label_variables
    toolchains = ["@bazel_tools//tools/jdk:remotejdk_17"],
)

js_binary(
    name = "generate_dynamo_local_create_table_commands",
    data = [":dynamo"],
    entry_point = "scripts/generate_dynamo_local_create_table_commands_main.js",
    env = {"NODE_ENV": "development"},
)
