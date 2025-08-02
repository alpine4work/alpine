load("@aspect_bazel_lib//lib:write_source_files.bzl", "write_source_files")
load("//admin/typescript:typescript.bzl", "ts_project")

CORE_SRCS = glob(
    ["core/**/*.ts"],
    exclude = ["core/**/*.test.ts"],
)

# We have a separate `design_core` package with a little number of essential
# helpers that can be used by rules that are expensive to rebuild (e.g.
# `sprinkles.css.js`) so every update to design doesn't cause a rebuild of
# these rules.
ts_project(
    name = "design_core",
    srcs = CORE_SRCS,
    # We lint and format everything with the below `ts_project()`.
    lint_and_format_srcs = [],
    test_srcs = [],
    visibility = ["//visibility:public"],
    deps = [
        "//:node_modules/@lume/kiwi",
        "//:node_modules/@types/react",
        "//shared/helpers:helpers_core",
        "//shared/id",
    ],
)

ts_project(
    name = "design",
    srcs = glob(
        ["**/*.ts"],
        exclude = CORE_SRCS + ["**/*.test.ts"],
    ),
    visibility = ["//visibility:public"],
    deps = [
        ":design_core",
        "//:node_modules/@internationalized/date",
        "//:node_modules/@types/color",
        "//:node_modules/@types/d3-interpolate",
        "//:node_modules/@types/react",
        "//:node_modules/color",
        "//:node_modules/d3-interpolate",
        "//:node_modules/date-fns",
        "//shared/helpers",
    ],
)

write_source_files(
    name = "write_font_metrics",
    files = {
        "core/font_metrics.ts": "//app/static:fonts/font_metrics.ts",
    },
)
