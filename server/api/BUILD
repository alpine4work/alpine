load("@aspect_rules_js//js:defs.bzl", "js_binary", "js_image_layer")
load("@rules_oci//oci:defs.bzl", "oci_image", "oci_load")
load("//admin/bazel:production_transition.bzl", "production_transition")
load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "api_lib",
    deps = [
        "//server/api/internal/chat",
        "//server/api/internal/documents",
        "//server/api/internal/forum",
        "//server/api/internal/shared",
        "//server/api/internal/spaces",
        "//server/api/internal/tasks",
        "//server/chat/data",
        "//server/cloudflare/r2",
        "//server/context",
        "//server/documents/data",
        "//server/forum/data",
        "//server/helpers",
        "//server/helpers/node",
        "//server/language_models/all_mini_lm_l6_v2",
        "//server/language_models/cohere_embed_english_v3",
        "//server/language_models/core",
        "//server/node",
        "//server/notifications/data",
        "//server/opensearch",
        "//server/search/data/index",
        "//server/spaces",
        "//server/tasks/data",
        "//shared/context",
        "//shared/helpers",
        "//shared/id",
        "//shared/tracer",
    ],
)

js_binary(
    name = "api",
    data = [":api_lib"],
    entry_point = "api_service_main.js",
    visibility = ["//admin/environment/test/integration:__pkg__"],
)

js_image_layer(
    name = "api_image_layer",
    binary = ":api",
    root = "/var/www",
)

oci_image(
    name = "api_image",
    base = "@debian_image",
    tars = [
        "//admin/aws:www_data_directory_layer",
        ":api_image_layer",
    ],
    # For security, use the `www-data` user which exists on our Linux image. It
    # only has read access and execute access to files on our system.
    user = "www-data",
)

oci_load(
    name = "api_image_tarball_load",
    image = ":api_image",
    repo_tags = ["cyberworlds-api-service:latest"],
)

filegroup(
    name = "api_image_tarball",
    srcs = [":api_image_tarball_load"],
    output_group = "tarball",
)

production_transition(
    name = "api_image_tarball_production",
    target = ":api_image_tarball",
    visibility = ["//admin/aws:__pkg__"],
)
