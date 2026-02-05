load("@aspect_rules_js//js:defs.bzl", "js_library")
load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "local",
    data = [
        ":java_path",
        ":local_data",
    ],
    visibility = [
        "//admin/dev:__pkg__",
        "//admin/environment/test/unit:__pkg__",
    ],
    deps = [
        "//:node_modules/@aws-sdk/client-sqs",
        "//:node_modules/fs-extra",
        "//admin/helpers",
        "//server/helpers/node",
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

# In a `js_library()` because `ts_project()` doesn't support `no_copy_to_bin`.
js_library(
    name = "local_data",
    data = [
        "@bazel_tools//tools/jdk:current_java_runtime",
        "@elasticmq//file",
    ],
    no_copy_to_bin = [
        "@bazel_tools//tools/jdk:current_java_runtime",
        "@elasticmq//file",
    ],
)
