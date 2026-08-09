load("@aspect_bazel_lib//lib:write_source_files.bzl", "write_source_files")
load("@aspect_rules_js//js:defs.bzl", "js_library")

genrule(
    name = "sqlite_types_with_alpine_extensions",
    srcs = [
        "sqlite_init_types.patch",
        "sqlite_types.patch",
        "@sqlite_dts//file",
    ],
    outs = ["sqlite3.generated.d.mts"],
    cmd = "cp $(location @sqlite_dts//file) $@ && patch $@ < $(location sqlite_types.patch) && patch $@ < $(location sqlite_init_types.patch)",
)

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
        "sqlite/ext/wasm/jswasm/sqlite3.d.mts": ":sqlite_types_with_alpine_extensions",
    },
)
