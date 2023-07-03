load("@aspect_rules_esbuild//esbuild:defs.bzl", "esbuild")
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
    config = "cloudflare_esbuild_config.cjs",
    entry_point = "edge_service.js",
    output = "edge_service_bundle.js",
)
