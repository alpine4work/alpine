load("@aspect_bazel_lib//lib:write_source_files.bzl", "write_source_files")
load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "design",
    visibility = ["//visibility:public"],
    deps = [
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
        "font_metrics.ts": "//app/static:_fonts/font_metrics.ts",
        "font_hashes.ts": "//app/static:_fonts/font_hashes.ts",
    },
)
