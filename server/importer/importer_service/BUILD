load("@aspect_rules_js//js:defs.bzl", "js_binary", "js_image_layer")
load("@rules_oci//oci:defs.bzl", "oci_image", "oci_load")
load("//admin/bazel:production_transition.bzl", "production_transition")
load("//admin/typescript:typescript.bzl", "ts_project")

# Service library for the standalone importer ECS task.
# This depends on //server/importer/notion, so it's separate from the base importer.
ts_project(
    name = "importer_service",
    visibility = [
        "//admin/crawl:__pkg__",
        "//server/importer:__subpackages__",
    ],
    deps = [
        "//:node_modules/env-paths",
        "//:node_modules/@aws-sdk/client-s3",
        "//:node_modules/@aws-sdk/credential-provider-node",
        "//server/chat/data",
        "//server/cloudflare/r2",
        "//server/context",
        "//server/documents/data",
        "//server/forum/data",
        "//server/helpers",
        "//server/importer",
        "//server/importer/notion",
        "//server/node",
        "//server/notifications/data",
        "//server/search/data/index",
        "//server/spaces",
        "//shared/context",
        "//shared/error",
        "//shared/helpers",
        "//shared/id",
        "//shared/tracer",
    ],
)

js_binary(
    name = "importer_binary",
    data = [":importer_service"],
    entry_point = "importer_service_main.js",
    visibility = [
        "//admin/dev:__pkg__",
    ],
)

js_image_layer(
    name = "importer_image_layer",
    binary = ":importer_binary",
    root = "/var/www",
)

oci_image(
    name = "importer_image",
    base = "@debian_image",
    tars = [
        "//admin/aws:www_data_directory_layer",
        ":importer_image_layer",
    ],
    # For security, use the `www-data` user which exists on our Linux image. It
    # only has read access and execute access to files on our system.
    user = "www-data",
)

oci_load(
    name = "importer_image_tarball_load",
    image = ":importer_image",
    repo_tags = ["cyberworlds-importer-service:latest"],
)

filegroup(
    name = "importer_image_tarball",
    srcs = [":importer_image_tarball_load"],
    output_group = "tarball",
)

production_transition(
    name = "importer_image_tarball_production",
    target = ":importer_image_tarball",
    visibility = ["//admin/aws:__pkg__"],
)
