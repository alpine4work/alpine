load("@aspect_rules_js//js:defs.bzl", "js_binary", "js_image_layer")
load("@rules_oci//oci:defs.bzl", "oci_image", "oci_tarball")
load("//admin/bazel:production_transition.bzl", "production_transition")
load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "upload_lib",
    data = ["@ffmpeg"],
    test_data = glob(["test_fixtures/*"]),
    test_deps = [
        "//:node_modules/get-port",
        "//:node_modules/looks-same",
        "//server/dynamo/test_helpers",
        "//server/files/upload/test_helpers",
        "//server/spaces/test_helpers",
    ],
    tests = {
        "processors/file_processor_content_types_microsoft_office_test": {
            "size": "medium",
            "tags": ["libreoffice"],
        },
    },
    visibility = ["//server/files/upload/test_helpers:__pkg__"],
    deps = [
        "//:node_modules/@miniflare/r2",
        "//:node_modules/@miniflare/storage-file",
        "//:node_modules/@types/node",
        "//:node_modules/decode-ico",
        "//:node_modules/pretty-bytes",
        "//:node_modules/sharp",
        "//server/accounts",
        "//server/cloudflare/r2",
        "//server/files/data",
        "//server/helpers",
        "//server/node",
        "//server/spaces",
        "//server/tracer",
        "//shared/error",
        "//shared/files",
        "//shared/helpers",
        "//shared/schema",
        "//shared/tracer",
    ],
)

js_binary(
    name = "upload",
    data = [":upload_lib"],
    entry_point = "file_upload_service_main.js",
    visibility = ["//app/integration_tests:__pkg__"],
)

js_image_layer(
    name = "upload_image_layer",
    binary = ":upload",
    root = "/var/www",
)

oci_image(
    name = "upload_image",
    base = "@debian",
    tars = [
        "//admin/aws:helpers/www_data_owned_directory_oci_layer.tar",
        ":upload_image_layer",
    ],
    # For security, use the `www-data` user which exists on our Linux image. It
    # only has read access and execute access to files on our system.
    user = "www-data",
)

oci_tarball(
    name = "upload_image_tarball",
    image = ":upload_image",
    repo_tags = ["cyberworlds-job-queue-service:latest"],
)

production_transition(
    name = "upload_image_tarball_production",
    target = ":upload_image_tarball",
    visibility = ["//admin/aws:__pkg__"],
)
