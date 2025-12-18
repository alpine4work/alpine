load("//admin/typescript:typescript.bzl", "ts_project")
load("@aspect_rules_esbuild//esbuild:defs.bzl", "esbuild")

ts_project(
    name = "service_worker_lib",
    srcs = ["service_worker.ts"],
    deps = [
        "//client/web/notifications",
        "//client/web/tracer",
        "//shared/error",
        "//shared/helpers",
        "//shared/id",
        "//shared/notifications",
        "//shared/tracer",
    ],
)


esbuild(
    name = "service_worker_bundle_file",
    srcs = [
        ":service_worker_lib",
        "//:package_light_json_file",
    ],
    config = "service_worker_esbuild_config.cjs",
    output = "service_worker_bundle.js",
    entry_point = "service_worker.js",
    sourcemap = False,
    visibility = ["//app/static:__subpackages__"],
)
