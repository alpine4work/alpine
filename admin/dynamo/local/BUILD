load("@aspect_rules_js//js:defs.bzl", "js_library")
load("//admin/typescript:typescript.bzl", "ts_project")
load("@npm//:dynamodb-admin/package_json.bzl", dynamodb_admin_bin = "bin")

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
        "//:node_modules/aws4fetch",
        "//:node_modules/fs-extra",
        "//:node_modules/is-port-reachable",
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
        "@dynamo_local//:DynamoDBLocal.jar",
        "@dynamo_local//:DynamoDBLocal_lib",
    ],
    no_copy_to_bin = [
        "@bazel_tools//tools/jdk:current_java_runtime",
        "@dynamo_local//:DynamoDBLocal.jar",
        "@dynamo_local//:DynamoDBLocal_lib",
    ],
)

dynamodb_admin_bin.dynamodb_admin_binary(
    name = "dynamodb_admin",
)

sh_binary(
    name = "gui",
    srcs = ["dynamo_local_gui.sh"],
    data = [
        ":dynamodb_admin",
        "//:env_files",
        # `ejs` is required as a peer dependency by `express`. Because of how pnpm
        # module resolution works, we need `ejs` as a dependency at the top-level or
        # else `express` can't reach it inside of `dynamodb-admin`.
        "//:node_modules/ejs",
    ],
    deps = ["@bazel_tools//tools/bash/runfiles"],
)
