load("@aspect_rules_js//js:defs.bzl", "js_binary", "js_image_layer")
load("@rules_oci//oci:defs.bzl", "oci_image", "oci_load")
load("//admin/aws/lambda:aws_lambda_deprecated.bzl", "aws_lambda_deprecated")
load("//admin/bazel:production_transition.bzl", "production_transition", "production_transition_executable")
load("//admin/typescript:typescript.bzl", "ts_project")

exports_files(glob(["test_fixtures/*"]))

ts_project(
    name = "processor_lib",
    data = ["@ffmpeg"],
    test_data = glob(["test_fixtures/*"]),
    test_deps = [
        "//:node_modules/@miniflare/core",
        "//:node_modules/@miniflare/r2",
        "//:node_modules/@miniflare/storage-file",
        "//:node_modules/get-port",
        "//:node_modules/looks-same",
        "//server/dynamo/test_helpers",
        "//server/edge:upload_file_testonly",
        "//server/files/processor/test_helpers",
        "//server/spaces/test_helpers",
        "//shared/test_helpers",
        "//shared/tracer/dev",
    ],
    tests = {
        "resize_file_test": {
            "size": "medium",
        },
        "processors/file_processor_content_types_test": {
            "size": "medium",
        },
        "processors/file_processor_content_types_microsoft_office_test": {
            "size": "large",
            "tags": ["libreoffice"],
        },
        "processors/file_processor_content_types_video_and_audio_test": {
            "size": "medium",
        },
    },
    visibility = [
        "//server/files/processor/test_helpers:__pkg__",
        "//admin/lambda/local/file_processor_service:__pkg__",
    ],
    deps = [
        "//:node_modules/@lezer/common",
        "//:node_modules/@lezer/highlight",
        "//:node_modules/date-fns",
        "//:node_modules/decode-ico",
        "//:node_modules/sharp",
        "//server/accounts",
        "//server/cloudflare/r2",
        "//server/context",
        "//server/files/data",
        "//server/helpers",
        "//server/helpers/node",
        "//server/jobs/queue/consumer",
        "//server/lambda",
        "//server/node",
        "//server/spaces",
        "//server/tokens",
        "//shared/avatar",
        "//shared/avatar/protocol",
        "//shared/content/code",
        "//shared/context",
        "//shared/error",
        "//shared/files",
        "//shared/helpers",
        "//shared/id",
        "//shared/tracer",
    ],
)

js_binary(
    name = "processor",
    data = [":processor_lib"],
    entry_point = "file_processor_service_main.js",
    visibility = ["//app/integration_tests:__pkg__"],
)

js_image_layer(
    name = "processor_image_layer",
    binary = ":processor",
    root = "/var/www",
)

oci_image(
    name = "processor_image",
    # NOTE(calebmer): What I've seen other tools that work with PDFs do is install
    # a bunch of common fonts into their container. I'm not quite sure what the use
    # case for this is yet (I'd hope most file types we work with have font data
    # embedded, or else it's not a good portable file type). I wouldn't be
    # surprised if SVGs and PDFs are allowed to reference system fonts. But such
    # files aren't portable so hopefully users are dissuaded from creating such
    # files.
    #
    # If we find a solid reason to include common system fonts in our container
    # some code to start with from Gotenberg:
    # https://github.com/gotenberg/gotenberg/blob/da8eeb5d8f98e689b7eaa9276c8847fb7a390994/build/Dockerfile#L67-L117
    base = "@ubuntu_libreoffice_image",
    tars = [
        "//admin/aws:www_data_directory_layer",
        ":processor_image_layer",
    ],
    # For security, use the `www-data` user which exists on our Linux image. It
    # only has read access and execute access to files on our system.
    user = "www-data",
)

oci_load(
    name = "processor_image_tarball_load",
    image = ":processor_image",
    repo_tags = ["cyberworlds-job-queue-service:latest"],
)

filegroup(
    name = "processor_image_tarball",
    srcs = [":processor_image_tarball_load"],
    output_group = "tarball",
)

# Convenience target for running:
#
# ```
# bazel run //server/files/processor:processor_image_tarball_load_production
# docker run -it cyberworlds-job-queue-service:latest /bin/bash
# ```
production_transition_executable(
    name = "processor_image_tarball_load_production",
    target = ":processor_image_tarball_load",
)

production_transition(
    name = "processor_image_tarball_production",
    target = ":processor_image_tarball",
    visibility = ["//admin/aws:__pkg__"],
)

# Lambda for file resizing (replaces ECS endpoint)
aws_lambda_deprecated(
    name = "resize_file_lambda",
    srcs = [":processor_lib"],
    entry_point = "lambda/resize_file_lambda.js",
    external_deps = [
        "//:node_modules/@aws-sdk/client-sqs",
        "//:node_modules/@types/aws-lambda",
        "//:node_modules/fs-extra",
        "//:node_modules/sharp",
        "//:node_modules/undici",
    ],
    visibility = ["//admin/aws:__pkg__"],
)

production_transition(
    name = "resize_file_lambda_production",
    target = ":resize_file_lambda",
    visibility = ["//admin/aws:__pkg__"],
)
