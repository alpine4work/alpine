load("@aspect_rules_js//js:defs.bzl", "js_binary", "js_image_layer")
load("@rules_oci//oci:defs.bzl", "oci_image", "oci_tarball")
load("//admin/bazel:linux_x86_64_platform_and_opt_compilation_mode.bzl", "linux_x86_64_platform_and_opt_compilation_mode")
load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "queue_lib",
    test_deps = ["//server/dynamo/test_helpers"],
    deps = [
        "//:node_modules/@types/fs-extra",
        "//:node_modules/fs-extra",
        "//server/apns",
        "//server/deploy/data",
        "//server/jobs/core",
        "//server/language_models/all_mini_lm_l6_v2",
        "//server/language_models/cohere_embed_english_v3",
        "//server/node",
        "//server/notifications/data",
        "//server/search/data/index",
        "//server/tasks/data",
        "//shared/error",
        "//shared/helpers",
        "//shared/schema",
    ],
)

js_binary(
    name = "queue",
    data = [":queue_lib"],
    entry_point = "job_queue_service.js",
    visibility = [
        "//app/integration_tests:__pkg__",
    ],
)

js_image_layer(
    name = "queue_image_layer",
    binary = ":queue",
    root = "/var/www",
)

oci_image(
    name = "queue_image",
    base = "@debian",
    tars = [
        "//admin/aws:helpers/www_data_owned_directory_oci_layer.tar",
        ":queue_image_layer",
    ],
    # For security, use the `www-data` user which exists on our Linux image. It
    # only has read access and execute access to files on our system.
    user = "www-data",
)

oci_tarball(
    name = "queue_image_tarball",
    image = ":queue_image",
    repo_tags = ["cyberworlds-job-queue-service:latest"],
)

linux_x86_64_platform_and_opt_compilation_mode(
    name = "queue_image_tarball_linux_x86_64_opt",
    src = ":queue_image_tarball",
    visibility = ["//admin/aws:__pkg__"],
)
