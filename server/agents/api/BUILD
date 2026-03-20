load("@aspect_rules_esbuild//esbuild:defs.bzl", "esbuild")
load("@aspect_rules_js//js:defs.bzl", "js_binary")
load("@npm//:wrangler/package_json.bzl", wrangler_bin = "bin")
load("//admin/bazel:production_transition.bzl", "production_transition")
load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name="api",
    visibility = [
        "//server/agents:__subpackages__",
    ],
    deps = [
        "//:node_modules/openapi-fetch",
        "//:node_modules/openapi-typescript-helpers",
        "//shared/api/specification",
        "//shared/error",
        "//shared/helpers",
        "//shared/tracer",
    ],
)
