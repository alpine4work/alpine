load("@aspect_rules_esbuild//esbuild:defs.bzl", "esbuild")
load("@aspect_rules_js//js:defs.bzl", "js_library")
load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "shared",
    test_deps = ["//:node_modules/expect-type"],
    visibility = ["//visibility:public"],
    deps = [
        ":styles",
        "//:node_modules/@types/d3-interpolate",
        "//:node_modules/@types/functional-red-black-tree",
        "//:node_modules/@vanilla-extract/css",
        "//:node_modules/@vanilla-extract/dynamic",
        "//:node_modules/@vanilla-extract/sprinkles",
        "//:node_modules/byte-base64",
        "//:node_modules/classnames",
        "//:node_modules/d3-interpolate",
        "//:node_modules/date-fns",
        "//:node_modules/functional-red-black-tree",
        "//:node_modules/prosemirror-model",
        "//:node_modules/prosemirror-state",
        "//:node_modules/prosemirror-transform",
    ],
)

STYLE_SRCS = [
    "styles/internal",
    "helpers",
    "content",
    "error",
]

esbuild(
    name = "styles_bundle",
    srcs = ["//:tsconfig_files"] + glob(
        ["{}/**/*.ts".format(src) for src in STYLE_SRCS] +
        ["{}/**/*.tsx".format(src) for src in STYLE_SRCS],
        exclude = ["{}/**/*.test.ts".format(src) for src in STYLE_SRCS] +
                  ["{}/**/*.test.tsx".format(src) for src in STYLE_SRCS],
    ),
    config = "styles/internal/styles_esbuild_config.js",
    entry_point = "styles/internal/styles.ts",
    # Leave font face `url()`s alone.
    external = ["*.woff2"],
    format = "cjs",
    output = "styles/styles.js",
    output_css = "styles/styles.css",
    platform = "neutral",
    splitting = False,
    deps = [
        "//:node_modules/@vanilla-extract/esbuild-plugin",
    ],
)

js_library(
    name = "styles",
    srcs = [
        "styles/styles.d.ts",
        ":styles_bundle",
    ],
)
