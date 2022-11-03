load("@aspect_rules_swc//swc:defs.bzl", "swc_transpiler")
load("@aspect_rules_ts//ts:defs.bzl", "ts_project")
load("//admin/bazel:helpers/ts_glob.bzl", "ts_glob")

ts_project(
    name = "app",
    srcs = ts_glob(["**/*"]),
    declaration = True,
    resolve_json_module = True,
    transpiler = swc_transpiler,
    tsconfig = "//:tsconfig",
    deps = [
        "//:node_modules/@axe-core/react",
        "//:node_modules/@cloudflare/workers-types",
        "//:node_modules/@remix-run/cloudflare",
        "//:node_modules/@remix-run/dev",
        "//client",
        "//server",
        "//shared",
    ],
)
