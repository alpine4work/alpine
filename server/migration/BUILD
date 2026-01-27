load("@aspect_rules_js//js:defs.bzl", "js_binary", "js_image_layer")
load("@rules_oci//oci:defs.bzl", "oci_image", "oci_load")
load("//admin/bazel:production_transition.bzl", "production_transition")
load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "migration_lib",
    deps = [
        "//server/accounts",
        "//server/bots",
        "//server/chat/data",
        "//server/documents/data",
        "//server/forum/data",
        "//server/helpers",
        "//server/node",
        "//server/notifications/data",
        "//server/search/data/table",
        "//server/spaces",
        "//server/tasks/data",
        "//shared/context",
        "//shared/error",
        "//shared/helpers",
        "//shared/id",
        "//shared/schema",
    ],
)

js_binary(
    name = "migration",
    data = [":migration_lib"],
    entry_point = "migration_service_main.js",
    visibility = [
        "//admin/dev:__pkg__",
    ],
)

js_image_layer(
    name = "migration_image_layer",
    binary = ":migration",
    root = "/var/www",
)

oci_image(
    name = "migration_image",
    base = "@debian_image",
    tars = [":migration_image_layer"],
    # For security, use the `www-data` user which exists on our Linux image. It
    # only has read access and execute access to files on our system.
    user = "www-data",
)

oci_load(
    name = "migration_image_tarball_load",
    image = ":migration_image",
    repo_tags = ["cyberworlds-migration-service:latest"],
)

filegroup(
    name = "migration_image_tarball",
    srcs = [":migration_image_tarball_load"],
    output_group = "tarball",
)

production_transition(
    name = "migration_image_tarball_production",
    target = ":migration_image_tarball",
    visibility = ["//admin/aws:__pkg__"],
)
