load("@aspect_bazel_lib//lib:write_source_files.bzl", "write_source_files")
load("@aspect_rules_js//js:defs.bzl", "js_library")

# We point TypeScript to this directory when you import `~/external`. This
# directory is designed to match the shape of Bazel's `external` directory and
# provide `.d.ts` types for the files within.

js_library(
    name = "sqlite",
    srcs = ["sqlite/ext/wasm/jswasm/sqlite3.d.mts"],
    visibility = ["//visibility:public"],
)

write_source_files(
    name = "write_external_types",
    files = {
        "sqlite/ext/wasm/jswasm/sqlite3.d.mts": "@sqlite_dts//file",
    },
)
