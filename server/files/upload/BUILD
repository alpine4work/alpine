load("@aspect_rules_js//js:defs.bzl", "js_binary", "js_image_layer")
load("@rules_oci//oci:defs.bzl", "oci_image", "oci_tarball")
load("//admin/bazel:production_transition.bzl", "production_transition")
load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "upload_lib",
    deps = [
        "//:node_modules/@types/node",
        "//:node_modules/sharp",
        "//server/helpers",
        "//server/node",
        "//server/tracer",
        "//shared/error",
        "//shared/helpers",
        "//shared/schema",
        "//shared/tracer",
    ],
)

js_binary(
    name = "upload",
    data = [":upload_lib"],
    entry_point = "file_upload_service.js",
    visibility = [
        "//app/integration_tests:__pkg__",
    ],
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
    src = ":upload_image_tarball",
    visibility = ["//admin/aws:__pkg__"],
)
