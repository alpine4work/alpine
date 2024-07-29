load("@aspect_bazel_lib//lib:write_source_files.bzl", "write_source_files")
load("@aspect_rules_js//js:defs.bzl", "js_binary", "js_run_binary")
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
        "//:node_modules/prettier",
        "//:node_modules/pretty-ms",
        "//:node_modules/yaml",
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

js_run_binary(
    name = "aws_app_templates_json",
    outs = [
        "output/CyberworldsLifecycleStack.template.json",
        "output/CyberworldsStack.template.json",
    ],
    args = ["synth"],
    tool = ":cdk",
)

js_binary(
    name = "aws_template_format",
    data = [":aws"],
    entry_point = "internal/aws_template_format_main.js",
    env = {"NODE_ENV": "development"},
)

js_run_binary(
    name = "aws_app_templates",
    srcs = [
        "output/CyberworldsLifecycleStack.template.json",
        "output/CyberworldsStack.template.json",
    ],
    outs = [
        "output/CyberworldsLifecycleStack.template.yaml",
        "output/CyberworldsStack.template.yaml",
    ],
    args = [
        "output/CyberworldsLifecycleStack.template.json",
        "output/CyberworldsStack.template.json",
    ],
    chdir = "admin/aws",
    tool = ":aws_template_format",
)

# Write the full CloudFormation templates to our repository. That way we can
# clearly catch any change to our AWS infrastructure and require it to be
# reviewed. For example, if a DynamoDB table is added no code in `admin/aws`
# will change, but the template `.yaml` file will change.
#
# Additionally, even if you make a change to `admin/aws` it's sometimes not
# immediately clear how that'll effect our AWS resources. Especially if we're
# using a third-party CDK library like `@cloudsnorkel/cdk-github-runners`.
# Having the templates available for inspection allows us to see exactly how
# we're using AWS.
write_source_files(
    name = "write_aws_app_templates",
    files = {
        "templates/cyberworlds_lifecycle_stack.yaml": "output/CyberworldsLifecycleStack.template.yaml",
        "templates/cyberworlds_stack.yaml": "output/CyberworldsStack.template.yaml",
    },
)
