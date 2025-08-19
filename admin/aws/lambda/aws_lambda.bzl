"""
Rules for creating an AWS Lambda function.

Bundles JavaScript code into a single file and creates a runfiles directory
with any runtime data the script needs.
"""

load("@aspect_bazel_lib//lib:output_files.bzl", "output_files")
load("@aspect_rules_esbuild//esbuild:defs.bzl", "esbuild")
load("@aspect_rules_js//js:defs.bzl", "js_binary", "js_image_layer")
load("@rules_oci//oci:defs.bzl", "oci_image", "oci_load")
load("//admin/esbuild:esbuild_runfiles_aspect.bzl", "esbuild_runfiles_without_sources")

def aws_lambda(
        name,
        srcs = [],
        entry_point = None,
        visibility = []):
    """
    Defines an AWS Lambda that can also be executed locally.

    Args:
        name: The name of the lambda.
        srcs: Any sources for the lambda. Typically a `ts_project()`.
        entry_point: The entry point into the lambda. Should export a `handler()`
        function.
        visibility: Controls who may depend on your lambda.
    """
    esbuild(
        name = "{}_bundle".format(name),
        srcs = srcs,
        entry_point = entry_point,
        output = "{}.mjs".format(name),
        config = "//admin/aws/lambda:aws_lambda_esbuild_config_file",
        # Can't set `splitting` in the ESBuild config file.
        # https://github.com/aspect-build/rules_esbuild/blob/798abd34bb9c9c1f79bc77ae1109bae2c9f7b68a/esbuild/private/launcher.js#L60
        splitting = False,
    )

    esbuild_runfiles_without_sources(
        name = "{}_runfiles".format(name),
        srcs = srcs,
    )

    # js_image_layer requires a js_binary target as input, but Lambda functions don't
    # need the executable wrapper created by `js_binary()` (i.e. resize_avatar_lambda.sh).
    # This js_binary exists solely to satisfy js_image_layer's API requirements - the
    # actual Lambda execution uses the bundled .mjs file and containerized dependencies.
    #
    # NOTE(ifitzsimmons, ##lambda-container-runfile-dir)
    # Bazel places all application code and its dependencies under the following
    # runfiles directory structure:
    #
    #   /<relative-path-to-BUILD>/<target-name>_binary.runfiles/**
    #   e.g. server/files/processor/resize_file_lambda_binary.runfiles/cyberworlds/server/files/processor/resize_file_lambda_binary.mjs
    #
    # When building the container image, these runfiles are copied into /var/task
    # (the Lambda task root). As a result, all Lambda handlers and dependencies
    # (e.g. ffmpeg) must be accessed through this path structure.
    #
    # I attempted to configure Bazel to place application code directly in /var/task,
    # but ran into difficulties. Since this has no impact on product behavior or
    # developer experience—and our Lambda container definitions are already
    # abstracted behind our lambda.ts construct (which sets the runfiles path as an
    # environment variable) - it's not worth pursuing further right now.
    js_binary(
        name = "{}_binary".format(name),
        data = [
            ":{}_bundle".format(name),
            ":{}_runfiles".format(name),
        ],
        entry_point = ":{}.mjs".format(name),
        no_copy_to_bin = [":{}_runfiles".format(name)],
    )

    # This image layer rule creates 5 separate tar.gz files for different parts of the
    # application:
    #   - package_store_3p.tar.gz - Third-party npm dependencies
    #   - package_store_1p.tar.gz - First-party/internal packages
    #   - node_modules.tar.gz - Direct node_modules links
    #   - app.tar.gz - Your bundled application code
    #   - node.tar.gz - The Node.js runtime binary and patches
    js_image_layer(
        name = "{}_image_layer".format(name),
        binary = ":{}_binary".format(name),
        root = "/var/task",
    )

    # This rule excludes the Node.js runtime binary and patches created by js_image_layer()
    # AWS Lambda already provides the Node.js 22 runtime (@lambda_node22_base).
    # Including our own Node.js binary would:
    # 1. Add ~35MB of unnecessary bloat
    # 2. Potentially conflict with AWS Lambda's runtime?
    # 3. Waste upload and cold start time
    output_files(
        name = "{}_image_layer_without_node".format(name),
        target = "{}_image_layer".format(name),
        paths = [
            "{}/{}_image_layer_package_store_3p.tar.gz".format(native.package_name(), name),
            "{}/{}_image_layer_package_store_1p.tar.gz".format(native.package_name(), name),
            "{}/{}_image_layer_node_modules.tar.gz".format(native.package_name(), name),
            "{}/{}_image_layer_app.tar.gz".format(native.package_name(), name),
        ],
    )

    # NOTE(ifitzsimmons, ##lambda-layer-container-image-strategy):
    # This creates a Docker image with distinct layers:
    #
    # 1. Base Layer (from @lambda_node22_base): AWS Lambda runtime + Node.js 22
    # 2. Third-party Layer (typically pretty large): All npm dependencies from external packages
    # 3. First-party Layer (typically small): Internal package dependencies
    # 4. Node modules Layer (typically small): Symlinks and module resolution
    # 5. Application Layer (typically small/medium): Your compiled Lambda function code
    #
    # Benefits of this layering:
    # - Caching: Docker layers are cached independently. If you only change your app code, only
    # that layer needs to be rebuilt, and it's typically pretty small.
    # - Fast uploads: Smaller layers upload faster to ECR, and unchanged layers are not pushed
    oci_image(
        name = "{}_lambda_image".format(name),
        base = "@lambda_node22_base",
        tars = [
            ":{}_image_layer_without_node".format(name),
        ],
        workdir = "/var/task", # keep LAMBDA_TASK_ROOT semantics
        cmd = [
            # NOTE(#lambda-container-runfile-dir)
            "{}/{}_binary.runfiles/cyberworlds/{}/{}.handler".format(
                native.package_name(),
                name,
                native.package_name(),
                name
            )
        ],
        labels = {
            "org.opencontainers.image.title": name,
        },
    )

    oci_load(
        name = "{}_image_layers_tarball_load".format(name),
        image = ":{}_lambda_image".format(name),
        repo_tags = ["cyberworlds-{}:latest".format(name)],
    )

    native.filegroup(
        name = "{}_image_tarball".format(name),
        srcs = [":{}_image_layers_tarball_load".format(name)],
        output_group = "tarball",
    )

    native.alias(
        name = name,
        actual = "{}_image_tarball".format(name),
    )
