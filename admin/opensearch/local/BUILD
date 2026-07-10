load("@aspect_rules_js//js:defs.bzl", "js_library")
load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "local",
    data = [
        ":java_base_path",
        ":local_data",
    ],
    visibility = [
        "//admin/dev:__pkg__",
        "//admin/environment/test/unit:__pkg__",
    ],
    deps = [
        "//:node_modules/fs-extra",
        "//:node_modules/get-port",
        "//:node_modules/murmurhash",
        "//admin/helpers",
        "//server/helpers/node",
        "//shared/error",
        "//shared/helpers",
    ],
)

genrule(
    name = "java_base_path",
    outs = ["java_base_path.txt"],
    cmd = "echo $(JAVABASE) > $@",
    toolchains = ["@bazel_tools//tools/jdk:current_java_runtime"],
)

# In a `js_library()` because `ts_project()` doesn't support `no_copy_to_bin`.
js_library(
    name = "local_data",
    data = [
        "@bazel_tools//tools/jdk:current_java_runtime",
        "@opensearch_local",
    ],
    no_copy_to_bin = [
        "@bazel_tools//tools/jdk:current_java_runtime",
        "@opensearch_local",
    ],
)

sh_binary(
    name = "gui",
    srcs = ["opensearch_dashboards_local.sh"],
    data = [
        "//:env_files",
        "//:node",
        "@opensearch_dashboards_local",
    ],
    deps = ["@bazel_tools//tools/bash/runfiles"],
)
