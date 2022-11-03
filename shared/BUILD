load("@aspect_rules_swc//swc:defs.bzl", "swc_transpiler")
load("@aspect_rules_ts//ts:defs.bzl", "ts_project")
load("@aspect_rules_esbuild//esbuild:defs.bzl", "esbuild")
load("//admin/bazel:helpers/ts_glob.bzl", "ts_glob")

ts_project(
    name = "shared",
    srcs = ts_glob(["**/*"]),
    declaration = True,
    resolve_json_module = True,
    transpiler = swc_transpiler,
    tsconfig = "//:tsconfig",
    visibility = ["//visibility:public"],
    deps = [
        "//:node_modules/@types/functional-red-black-tree",
        "//:node_modules/@vanilla-extract/css",
        "//:node_modules/@vanilla-extract/dynamic",
        "//:node_modules/@vanilla-extract/sprinkles",
        "//:node_modules/byte-base64",
        "//:node_modules/classnames",
        "//:node_modules/date-fns",
        "//:node_modules/functional-red-black-tree",
        "//:node_modules/prosemirror-model",
        "//:node_modules/prosemirror-transform",
    ],
)

esbuild(
    name = "styles",
    srcs = ts_glob(["styles/internal/**/*"]),
    config = "styles/internal/styles-esbuild-config-plugins.js",
    entry_point = "styles/internal/styles.ts",
    # Leave font face `url()`s alone.
    external = ["*.woff2"],
    format = "esm",
    output = "styles/styles.js",
    output_css = "styles/styles.css",
    platform = "neutral",
    splitting = False,
    deps = [
        "//:node_modules/@vanilla-extract/esbuild-plugin",
    ],
)
