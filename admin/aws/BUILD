load("@npm//:aws-cdk/package_json.bzl", cdk_bin = "bin")
load("//admin/typescript:typescript.bzl", "ts_project")

# A manually built OCI layer that creates a directory `/var/www-data` and
# grants write access for that directory to the `www-data` user.
exports_files([
    "helpers/www_data_owned_directory_oci_layer.tar",
])

ts_project(
    name = "aws",
    data = [
        "//admin/opensearch/deploy",
        "//app:app_image_tarball_linux_x86_64_opt",
        "//server/jobs/queue:queue_image_tarball_linux_x86_64_opt",
        "//server/migration:migration_image_tarball_linux_x86_64_opt",
        "//server/tasks/realtime:realtime_image_tarball_linux_x86_64_opt",
        "//server/tasks/realtime/gateway:gateway_image_tarball_linux_x86_64_opt",
    ],
    deps = [
        "//:node_modules/@cloudsnorkel/cdk-github-runners",
        "//:node_modules/aws-cdk-lib",
        "//:node_modules/chalk",
        "//:node_modules/constructs",
        "//:node_modules/fs-extra",
        "//:node_modules/pretty-ms",
        "//admin/cron",
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
