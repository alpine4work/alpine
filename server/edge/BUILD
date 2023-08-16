load("@aspect_rules_esbuild//esbuild:defs.bzl", "esbuild")
load("@aspect_rules_js//js:defs.bzl", "js_binary")
load("@npm//:wrangler/package_json.bzl", wrangler_bin = "bin")
load("//admin/bazel:opt_compilation_mode.bzl", "opt_compilation_mode")
load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "edge_lib",
    deps = [
        "//server/chat/realtime",
        "//server/cloudflare",
        "//server/documents/collaboration",
        "//server/forum/realtime",
        "//server/notifications/my_account",
        "//server/tracer",
        "//shared/helpers",
        "//shared/schema",
    ],
)

esbuild(
    name = "edge_service_bundle_file",
    srcs = [
        ":edge_lib",
        "//:package_light_json_file",
    ],
    config = "edge_esbuild_config.cjs",
    entry_point = "edge_service.js",
    output = "edge_service_bundle.js",
    splitting = False,
)

js_binary(
    name = "edge",
    data = [
        "wrangler.toml",
        ":edge_lib",
        ":edge_service_bundle_file",
        "//:node_modules/fs-extra",
        "//:node_modules/miniflare",
        "//:node_modules/toml",
        "//:package_light_json_file",
        "//server/helpers",
    ],
    entry_point = "edge_service_dev_main.mjs",
    env = {"NODE_ENV": "development"},
    node_options = ["--experimental-vm-modules"],
    visibility = ["//app/integration_tests:__pkg__"],
)

opt_compilation_mode(
    name = "edge_service_bundle_file_opt",
    src = ":edge_service_bundle_file",
)

wrangler_bin.wrangler_binary(
    name = "wrangler",
    chdir = package_name(),
    data = [
        "wrangler.toml",
        ":edge_service_bundle_file_opt",
    ],
    visibility = ["//admin/deploy:__pkg__"],
)
