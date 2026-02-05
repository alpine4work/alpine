load("@aspect_rules_js//js:defs.bzl", "js_binary", "js_image_layer")
load("@rules_oci//oci:defs.bzl", "oci_image", "oci_load")
load("//admin/bazel:production_transition.bzl", "production_transition", "production_transition_executable")
load("//admin/typescript:typescript.bzl", "ts_project")

exports_files(glob(["test_fixtures/*"]))

LOCAL_SRCS = [
    "file_processor_local_service.ts",
    "file_processor_local_service_main.ts",
]

ts_project(
    name = "processor_lib",
    srcs = glob(
        ["**/*.ts"],
        exclude = LOCAL_SRCS + ["**/*.test.ts"],
    ),
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
    visibility = ["//server/files/processor:__subpackages__"],
    deps = [
        "//:node_modules/@lezer/common",
        "//:node_modules/@lezer/highlight",
        "//:node_modules/date-fns",
        "//:node_modules/decode-ico",
        "//:node_modules/sharp",
        "//server/aws",
        "//server/cloudflare/r2",
        "//server/context",
        "//server/files/data",
        "//server/files/processor/error",
        "//server/files/processor/sharp",
        "//server/helpers",
        "//server/helpers/node",
        "//server/jobs/queue/consumer",
        "//server/node",
        "//server/spaces",
        "//server/tokens",
        "//shared/content/code",
        "//shared/context",
        "//shared/error",
        "//shared/files",
        "//shared/helpers",
        "//shared/id",
        "//shared/schema",
        "//shared/tracer",
    ],
)

js_binary(
    name = "processor_legacy",
    data = [":processor_lib"],
    entry_point = "file_processor_service_main.js",
    visibility = ["//app/integration_tests:__pkg__"],
)

js_image_layer(
    name = "processor_image_layer",
    binary = ":processor_legacy",
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

ts_project(
    name = "processor_local_lib",
    srcs = LOCAL_SRCS,
    # We lint and format everything with the above `ts_project()`.
    lint_and_format_srcs = [],
    test_srcs = [],
    deps = [
        ":processor_lib",
        "//admin/lambda/local",
        "//server/files/processor/process_file",
        "//server/files/processor/resize_avatar",
        "//server/files/processor/resize_file",
        "//server/helpers/node",
        "//server/lambda",
        "//server/node",
        "//shared/error",
        "//shared/helpers",
        "//shared/tracer",
    ],
)

js_binary(
    name = "processor",
    data = [":processor_local_lib"],
    entry_point = "file_processor_local_service_main.js",
    visibility = ["//admin/environment/test/integration:__pkg__"],
)
