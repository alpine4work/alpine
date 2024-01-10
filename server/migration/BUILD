load("@aspect_rules_js//js:defs.bzl", "js_binary", "js_image_layer")
load("@rules_oci//oci:defs.bzl", "oci_image", "oci_tarball")
load("//admin/bazel:linux_x86_64_platform_and_opt_compilation_mode.bzl", "linux_x86_64_platform_and_opt_compilation_mode")
load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "migration_lib",
    deps = [
        "//server/chat/data",
        "//server/documents/data",
        "//server/forum/data",
        "//server/helpers",
        "//server/node",
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
    entry_point = "migration_service.js",
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
    base = "@debian",
    tars = [":migration_image_layer"],
    # For security, use the `www-data` user which exists on our Linux image. It
    # only has read access and execute access to files on our system.
    user = "www-data",
)

oci_tarball(
    name = "migration_image_tarball",
    image = ":migration_image",
    repo_tags = ["cyberworlds-migration-service:latest"],
)

linux_x86_64_platform_and_opt_compilation_mode(
    name = "migration_image_tarball_linux_x86_64_opt",
    src = ":migration_image_tarball",
    visibility = ["//admin/aws:__pkg__"],
)
