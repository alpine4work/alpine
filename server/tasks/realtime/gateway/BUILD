load("@aspect_rules_js//js:defs.bzl", "js_binary", "js_image_layer")
load("@rules_oci//oci:defs.bzl", "oci_image", "oci_load")
load("//admin/bazel:production_transition.bzl", "production_transition")
load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "gateway_lib",
    deps = [
        "//:node_modules/@types/node",
        "//server/helpers/node",
        "//shared/helpers",
    ],
)

js_binary(
    name = "gateway",
    data = [":gateway_lib"],
    entry_point = "task_realtime_service_gateway.js",
    visibility = ["//app/integration_tests:__pkg__"],
)

js_image_layer(
    name = "gateway_image_layer",
    binary = ":gateway",
    root = "/var/www",
)

oci_image(
    name = "gateway_image",
    base = "@debian_image",
    tars = [":gateway_image_layer"],
    # For security, use the `www-data` user which exists on our Linux image. It
    # only has read access and execute access to files on our system.
    user = "www-data",
)

oci_load(
    name = "gateway_image_tarball_load",
    image = ":gateway_image",
    repo_tags = ["cyberworlds-task-realtime-service-gateway:latest"],
)

filegroup(
    name = "gateway_image_tarball",
    srcs = [":gateway_image_tarball_load"],
    output_group = "tarball",
)

production_transition(
    name = "gateway_image_tarball_production",
    target = ":gateway_image_tarball",
    visibility = ["//admin/aws:__pkg__"],
)
