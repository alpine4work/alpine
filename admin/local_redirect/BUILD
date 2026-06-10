load("@aspect_rules_esbuild//esbuild:defs.bzl", "esbuild")
load("@aspect_rules_js//js:defs.bzl", "js_binary")
load("@npm//:wrangler/package_json.bzl", wrangler_bin = "bin")
load("//admin/bazel:production_transition.bzl", "production_transition")
load("//admin/typescript:typescript.bzl", "ts_project")


ts_project(
    name = "local_redirect_service_lib",
    srcs = glob(
        ["**/*.ts"],
        exclude = ["**/*.test.ts"],
    ),
    deps = [
        "//server/cloudflare",
        "//server/helpers",
        "//server/tracer",
        "//shared/error",
        "//shared/helpers",
    ],
)

esbuild(
    name = "local_redirect_service_bundle_file",
    srcs = [
        ":local_redirect_service_lib",
        "//:package_light_json_file",
    ],
    config = "local_redirect_service_esbuild_config.cjs",
    entry_point = "local_redirect_service.js",
    output = "local_redirect_service_bundle.js",
)

js_binary(
    name = "local_redirect",
    data = [
        "wrangler.toml",
        ":local_redirect_service_lib",
        ":local_redirect_service_bundle_file",
        "//:node_modules/fs-extra",
        "//:node_modules/miniflare",
        "//:node_modules/toml",
        "//:package_light_json_file",
        "//server/helpers",
        "//shared/tracer/dev",
    ],
    entry_point = "local_redirect_service_dev_main.mjs",
    env = {"NODE_ENV": "development"},
    node_options = ["--experimental-vm-modules"],
    visibility = ["//app/integration_tests:__pkg__"],
)

production_transition(
    name = "local_redirect_service_bundle_file_production",
    target = ":local_redirect_service_bundle_file",
)

wrangler_bin.wrangler_binary(
    name = "wrangler",
    chdir = package_name(),
    data = [
        "wrangler.toml",
        ":local_redirect_service_bundle_file_production",
    ],
    visibility = ["//server/deploy/script:__pkg__"],
)
