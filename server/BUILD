load("@aspect_rules_swc//swc:defs.bzl", "swc_transpiler")
load("@aspect_rules_ts//ts:defs.bzl", "ts_project")
load("//admin/bazel:helpers/ts_glob.bzl", "ts_glob")

ts_project(
    name = "server",
    srcs = ts_glob(["**/*"]),
    allow_js = True,
    declaration = True,
    resolve_json_module = True,
    transpiler = swc_transpiler,
    tsconfig = "//:tsconfig",
    deps = [
        "//:node_modules/@aws-sdk/client-dynamodb",
        "//:node_modules/@cloudflare/workers-types",
        "//:node_modules/@remix-run/cloudflare",
        "//:node_modules/@types/jest",
        "//:node_modules/@types/json-stable-stringify",
        "//:node_modules/aws4fetch",
        "//:node_modules/jose",
        "//:node_modules/json-stable-stringify",
        "//:node_modules/prosemirror-state",
        "//:node_modules/prosemirror-transform",
        "//shared",
    ],
)
