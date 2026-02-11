load("@aspect_bazel_lib//lib:write_source_files.bzl", "write_source_files")
load("@aspect_bazel_lib//lib:tar.bzl", "tar")
load("@aspect_rules_js//js:defs.bzl", "js_binary", "js_image_layer", "js_run_binary")
load("@rules_oci//oci:defs.bzl", "oci_image", "oci_load")
load("@npm//:aws-cdk/package_json.bzl", cdk_bin = "bin")
load("//admin/aws/lambda:aws_lambda_deprecated.bzl", "aws_lambda_deprecated")
load("//admin/bazel:production_transition.bzl", "production_transition")
load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "aws",
    deps = [
        "//:node_modules/@cloudsnorkel/cdk-github-runners",
        "//:node_modules/@types/prettier",
        "//:node_modules/aws-cdk-lib",
        "//:node_modules/constructs",
        "//:node_modules/fs-extra",
        "//:node_modules/prettier",
        "//:node_modules/yaml",
        "//admin/crawl",
        "//admin/cron",
        "//admin/glue",
        "//server/dynamo/core",
        "//server/helpers/node",
        "//server/jobs/core",
        "//server/tasks/router",
        "//shared/error",
        "//shared/files",
        "//shared/helpers",
        "//shared/schema",
    ],
)

filegroup(
    name = "cdk_data",
    data = [
        ":aws",
        "//:cdk_files",
        "//admin/lambda/schedule_deploy:schedule_deploy_lambda_production",
        "//admin/lambda/send_alert:send_alert_lambda_production",
        "//admin/opensearch/deploy_script:deploy_script_production",
        "//app:app_image_tarball_production",
        "//server/api:api_image_tarball_production",
        "//server/files/processor:processor_image_tarball_production",
        "//server/files/processor/process_file:process_file_lambda_production",
        "//server/files/processor/resize_avatar:resize_avatar_lambda_production",
        "//server/files/processor/resize_file:resize_file_lambda_production",
        "//server/jobs/queue:queue_image_tarball_production",
        "//server/migration:migration_image_tarball_production",
        "//server/tasks/realtime:realtime_image_tarball_production",
        "//server/tasks/realtime/gateway:gateway_image_tarball_production",
    ],
    visibility = ["//server/deploy/script:__pkg__"],
)

cdk_bin.cdk_binary(
    name = "cdk",
    data = [":cdk_data"],
    env = {
        "NODE_ENV": "production",
    },
)

# The "lite" CDK binary is configured to reference empty container images
# instead of the full service container images. That way the output of
# `cdk_lite` doesn't change when the code for one of our services changes.
#
# Useful since remote caching won't need to invalidate anything depending on
# this whenever any code changes.
cdk_bin.cdk_binary(
    name = "cdk_lite",
    data = [
        ":aws",
        ":empty_image_tarball_production",
        ":empty_lambda",
        "//:cdk_files",
    ],
    env = {
        "NODE_ENV": "production",
        "CDK_LITE": "true",
    },
)

aws_lambda_deprecated(
    name = "empty_lambda",
    entry_point = "internal/empty.cjs",
)

js_binary(
    name = "empty",
    entry_point = "internal/empty.cjs",
    visibility = ["//app/integration_tests:__pkg__"],
)

js_image_layer(
    name = "empty_image_layer",
    binary = ":empty",
    root = "/var/www",
)

oci_image(
    name = "empty_image",
    base = "@debian_image",
    tars = [":empty_image_layer"],
    user = "www-data",
)

oci_load(
    name = "empty_image_tarball_load",
    image = ":empty_image",
    repo_tags = ["cyberworlds-empty-service:latest"],
)

filegroup(
    name = "empty_image_tarball",
    srcs = [":empty_image_tarball_load"],
    output_group = "tarball",
)

production_transition(
    name = "empty_image_tarball_production",
    target = ":empty_image_tarball",
)

js_run_binary(
    name = "aws_app_templates_json",
    outs = [
        "output_lite/CyberworldsLifecycleStack.template.json",
        "output_lite/CyberworldsObservabilityStack.template.json",
        "output_lite/CyberworldsStack.template.json",
    ],
    args = [
        "synth",
        "--output=admin/aws/output_lite",
    ],
    progress_message = "Synthesizing AWS templates",
    tool = ":cdk_lite",
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
        "output_lite/CyberworldsLifecycleStack.template.json",
        "output_lite/CyberworldsObservabilityStack.template.json",
        "output_lite/CyberworldsStack.template.json",
    ],
    outs = [
        "output_lite/CyberworldsLifecycleStack.template.yaml",
        "output_lite/CyberworldsObservabilityStack.template.yaml",
        "output_lite/CyberworldsStack.template.yaml",
    ],
    args = [
        "output_lite/CyberworldsLifecycleStack.template.json",
        "output_lite/CyberworldsStack.template.json",
        "output_lite/CyberworldsObservabilityStack.template.json",
    ],
    chdir = "admin/aws",
    progress_message = "Formatting AWS templates",
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
        "templates/cyberworlds_lifecycle_stack.yaml": "output_lite/CyberworldsLifecycleStack.template.yaml",
        "templates/cyberworlds_stack.yaml": "output_lite/CyberworldsStack.template.yaml",
        "templates/cyberworlds_observability_stack.yaml": "output_lite/CyberworldsObservabilityStack.template.yaml",
    },
)

# Layer for a container built with `oci_image()` that creates a `/var/www-data`
# directory which the `www-data` user has write access to. The `www-data` user
# can't write to anything else in the container.
tar(
    name = "www_data_directory_layer",
    mtree = [
        # 33 is the `uid` of the `www-data` user in our Linux container.
        "var/www-data uid=33 gid=33 mode=0770 type=dir",
    ],
    visibility = ["//visibility:public"],
)
