load("@aspect_rules_js//js:defs.bzl", "js_binary", "js_image_layer")
load("@rules_oci//oci:defs.bzl", "oci_image", "oci_load")
load("//admin/bazel:production_transition.bzl", "production_transition")
load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "realtime_lib",
    test_deps = [
        "//server/dynamo/test_helpers",
        "//server/sites/test_helpers",
        "//server/spaces/test_helpers",
        "//server/tasks/realtime/test_helpers",
        "//server/tasks/test_helpers",
        "//shared/tasks/test_helpers",
        "//shared/tracer/dev",
        "//shared/test_helpers",
    ],
    tests = {
        # These are kind of chunky tests that use OpenSearch. We configure OpenSearch
        # in tests to use 2 CPUs (see `startOpensearchLocal()`) so reserve those
        # resources in Bazel and one for the test process.
        "task_realtime_connection_test": {
            "size": "medium",
            "tags": ["cpu:3"],
        },
        "task_realtime_server_test": {
            "size": "medium",
            "tags": ["cpu:3"],
        },
        "task_data_with_realtime_server_test": {
            "size": "medium",
            "tags": ["cpu:3"],
        },
    },
    visibility = ["//server/tasks/realtime/test_helpers:__pkg__"],
    deps = [
        "//:node_modules/@types/bintrees",
        "//:node_modules/bintrees",
        "//:node_modules/fs-extra",
        "//server/chat/data",
        "//server/documents/data",
        "//server/forum/data",
        "//server/node",
        "//server/sites/data",
        "//server/tasks/data",
        "//server/tasks/router",
        "//server/tokens",
        "//server/web_socket",
        "//shared/error",
        "//shared/helpers",
        "//shared/id",
        "//shared/schema",
        "//shared/tasks",
    ],
)

js_binary(
    name = "realtime",
    data = [":realtime_lib"],
    entry_point = "task_realtime_service_main.js",
    visibility = ["//admin/environment/test/integration:__pkg__"],
)

js_image_layer(
    name = "realtime_image_layer",
    binary = ":realtime",
    root = "/var/www",
)

oci_image(
    name = "realtime_image",
    base = "@debian_image",
    tars = [":realtime_image_layer"],
    # For security, use the `www-data` user which exists on our Linux image. It
    # only has read access and execute access to files on our system.
    user = "www-data",
)

oci_load(
    name = "realtime_image_tarball_load",
    image = ":realtime_image",
    repo_tags = ["cyberworlds-task-realtime-service:latest"],
)

filegroup(
    name = "realtime_image_tarball",
    srcs = [":realtime_image_tarball_load"],
    output_group = "tarball",
)

production_transition(
    name = "realtime_image_tarball_production",
    target = ":realtime_image_tarball",
    visibility = ["//admin/aws:__pkg__"],
)
