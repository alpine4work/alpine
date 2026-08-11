load("@aspect_bazel_lib//lib:copy_to_bin.bzl", "copy_to_bin")
load("@aspect_rules_js//js:defs.bzl", "js_binary")
load("@aspect_rules_esbuild//esbuild:defs.bzl", "esbuild")
load("@npm//:wrangler/package_json.bzl", wrangler_bin = "bin")
load("//admin/bazel:production_transition.bzl", "production_transition")
load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "dev_lib",
    data = [":wrangler", "//server/agents/bots_v2"],
    deps = [
        "//:node_modules/@inquirer/prompts",
        "//:node_modules/chalk",
        "//admin/helpers",
        "//server/helpers",
        "//server/helpers/node",
        "//shared/helpers",
    ],
)

js_binary(
    name = "dev",
    data = [":dev_lib"],
    entry_point = "agent_v2_service_dev_main.js",
    env = {
        "NODE_ENV": "development",
    },
)

wrangler_bin.wrangler_binary(
    name = "wrangler",
)
