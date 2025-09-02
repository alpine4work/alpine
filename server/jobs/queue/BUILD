load("@aspect_rules_js//js:defs.bzl", "js_binary", "js_image_layer")
load("@rules_oci//oci:defs.bzl", "oci_image", "oci_load")
load("//admin/bazel:production_transition.bzl", "production_transition")
load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "queue_lib",
    test_deps = ["//server/dynamo/test_helpers"],
    deps = [
        "//:node_modules/@octokit/auth-app",
        "//:node_modules/@types/fs-extra",
        "//:node_modules/fs-extra",
        "//server/apns",
        "//server/bots",
        "//server/content/context_module",
        "//server/deploy/data",
        "//server/feed",
        "//server/jobs/core",
        "//server/jobs/queue/consumer",
        "//server/language_models/all_mini_lm_l6_v2",
        "//server/language_models/cohere_embed_english_v3",
        "//server/node",
        "//server/notifications/data",
        "//server/search/data/index",
        "//server/emails",
        "//server/tasks/data",
        "//shared/error",
        "//shared/helpers",
        "//shared/schema",
    ],
)

js_binary(
    name = "queue",
    data = [":queue_lib"],
    entry_point = "job_queue_service_main.js",
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
    base = "@debian_image",
    tars = [
        "//admin/aws:www_data_directory_layer",
        ":queue_image_layer",
    ],
    # For security, use the `www-data` user which exists on our Linux image. It
    # only has read access and execute access to files on our system.
    user = "www-data",
)

oci_load(
    name = "queue_image_tarball_load",
    image = ":queue_image",
    repo_tags = ["cyberworlds-job-queue-service:latest"],
)

filegroup(
    name = "queue_image_tarball",
    srcs = [":queue_image_tarball_load"],
    output_group = "tarball",
)

production_transition(
    name = "queue_image_tarball_production",
    target = ":queue_image_tarball",
    visibility = ["//admin/aws:__pkg__"],
)
