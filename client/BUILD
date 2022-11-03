load("@aspect_rules_swc//swc:defs.bzl", "swc_transpiler")
load("@aspect_rules_ts//ts:defs.bzl", "ts_project")
load("//admin/bazel:helpers/ts_glob.bzl", "ts_glob")

ts_project(
    name = "client",
    srcs = ts_glob(["**/*"]),
    allow_js = True,
    declaration = True,
    resolve_json_module = True,
    transpiler = swc_transpiler,
    tsconfig = "//:tsconfig",
    visibility = ["//visibility:public"],
    deps = [
        "//:node_modules/@popperjs/core",
        "//:node_modules/@react-aria/interactions",
        "//:node_modules/@remix-run/react",
        "//:node_modules/@types/dedent",
        "//:node_modules/@types/jest",
        "//:node_modules/@types/react",
        "//:node_modules/@types/react-dom",
        "//:node_modules/ably",
        "//:node_modules/dedent",
        "//:node_modules/murmurhash",
        "//:node_modules/phosphor-react",
        "//:node_modules/prosemirror-collab",
        "//:node_modules/prosemirror-commands",
        "//:node_modules/prosemirror-history",
        "//:node_modules/prosemirror-inputrules",
        "//:node_modules/prosemirror-keymap",
        "//:node_modules/prosemirror-state",
        "//:node_modules/prosemirror-view",
        "//:node_modules/react",
        "//:node_modules/react-aria",
        "//:node_modules/react-dom",
        "//:node_modules/react-router-dom",
        "//shared",
    ],
)
