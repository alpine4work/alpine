load("@aspect_rules_esbuild//esbuild:defs.bzl", "esbuild")
load("@aspect_rules_js//js:defs.bzl", "js_library")
load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "styles",
    visibility = ["//visibility:public"],
    deps = [
        ":styles_bundle",
        "//:node_modules/@types/color",
        "//:node_modules/@vanilla-extract/css",
        "//:node_modules/@vanilla-extract/sprinkles",
        "//:node_modules/color",
        "//shared/design",
        "//shared/error",
        "//shared/helpers",
    ],
)

esbuild(
    name = "styles_bundle_file",
    srcs = [
        "//:tsconfig_files",
        "//:node_modules/@vanilla-extract/css",
        "//:node_modules/@vanilla-extract/sprinkles",
    ] + glob(
        [
            "**/*.ts",
            "**/*.tsx",
        ],
        exclude = [
            "**/*.test.ts",
            "**/*.test.tsx",
        ],
    ),
    config = "internal/styles_esbuild_config.cjs",
    entry_point = "internal/styles.ts",
    # Leave font face `url()`s alone.
    external = [
        "*.woff2",
        "*.ttf",
    ],
    format = "esm",
    output = "styles.js",
    output_css = "styles.css",
    platform = "neutral",
    splitting = False,
    deps = [
        "//:node_modules/@types/color",
        "//:node_modules/@vanilla-extract/esbuild-plugin",
        "//:node_modules/autoprefixer",
        "//:node_modules/color",
        "//:node_modules/postcss",
        "//:node_modules/prosemirror-view",
        "//shared/design",
        "//shared/error",
        "//shared/helpers",
    ],
)

js_library(
    name = "styles_bundle",
    srcs = [":styles_bundle_file"],
)
