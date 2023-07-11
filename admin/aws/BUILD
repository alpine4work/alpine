load("@npm//:aws-cdk/package_json.bzl", cdk_bin = "bin")
load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "aws",
    data = [
        "//app:app_image_tarball_linux_x86_64_opt",
    ],
    visibility = ["//app/dev:__pkg__"],
    deps = [
        "//:node_modules/aws-cdk-lib",
        "//:node_modules/chalk",
        "//:node_modules/constructs",
        "//:node_modules/fs-extra",
        "//:node_modules/pretty-ms",
        "//admin/helpers",
        "//server/dynamo",
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
)
