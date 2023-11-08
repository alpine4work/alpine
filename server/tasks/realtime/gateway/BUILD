load("@aspect_rules_js//js:defs.bzl", "js_binary", "js_image_layer")
load("@rules_oci//oci:defs.bzl", "oci_image", "oci_tarball")
load("//admin/bazel:linux_x86_64_platform_and_opt_compilation_mode.bzl", "linux_x86_64_platform_and_opt_compilation_mode")
load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "gateway_lib",
    deps = [
        "//:node_modules/@types/node",
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
    base = "@debian",
    tars = [":gateway_image_layer"],
    # For security, use the `www-data` user which exists on our Linux image. It
    # only has read access and execute access to files on our system.
    user = "www-data",
)

oci_tarball(
    name = "gateway_image_tarball",
    image = ":gateway_image",
    repo_tags = ["cyberworlds-task-realtime-service-gateway:latest"],
)

linux_x86_64_platform_and_opt_compilation_mode(
    name = "gateway_image_tarball_linux_x86_64_opt",
    src = ":gateway_image_tarball",
    visibility = ["//admin/aws:__pkg__"],
)
