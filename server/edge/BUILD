load("@aspect_rules_esbuild//esbuild:defs.bzl", "esbuild")
load("@aspect_rules_js//js:defs.bzl", "js_binary")
load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "edge_lib",
    deps = [
        "//server/chat",
        "//server/cloudflare",
        "//server/documents",
        "//server/forum",
        "//server/notifications",
        "//server/tracer",
        "//shared/helpers",
        "//shared/schema",
    ],
)

esbuild(
    name = "edge_service_bundle_file",
    srcs = [":edge_lib"],
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
        "//:package_light_json_file",
        "//server/helpers",
    ],
    entry_point = "edge_service_dev_main.mjs",
    env = {"NODE_ENV": "development"},
    node_options = ["--experimental-vm-modules"],
)
