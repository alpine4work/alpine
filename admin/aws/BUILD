load("@npm//:aws-cdk/package_json.bzl", cdk_bin = "bin")
load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "aws",
    data = [
        "//admin/opensearch/deploy:deploy_lambda_directory",
        "//app:app_image_tarball_linux_x86_64_opt",
        "//server/tasks/realtime:realtime_image_tarball_linux_x86_64_opt",
        "//server/tasks/realtime/gateway:gateway_image_tarball_linux_x86_64_opt",
    ],
    deps = [
        "//:node_modules/aws-cdk-lib",
        "//:node_modules/chalk",
        "//:node_modules/constructs",
        "//:node_modules/fs-extra",
        "//:node_modules/pretty-ms",
        "//admin/dynamo",
        "//admin/helpers",
        "//server/helpers/node",
        "//server/tasks/router",
        "//shared/helpers",
    ],
)

cdk_bin.cdk_binary(
    name = "cdk",
    data = [
        ":aws",
        "//:cdk_files",
    ],
    env = {
        "NODE_ENV": "production",
    },
    visibility = ["//admin/deploy:__pkg__"],
)
