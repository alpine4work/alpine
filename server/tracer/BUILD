load("@aspect_bazel_lib//lib:write_source_files.bzl", "write_source_files")
load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "tracer",
    visibility = [
        "//admin:__subpackages__",
        "//app:__subpackages__",
        "//server:__subpackages__",
    ],
    deps = [
        "//:node_modules/@types/fs-extra",
        "//:node_modules/env-paths",
        "//:node_modules/fs-extra",
        "//shared/error",
        "//shared/helpers",
        "//shared/schema",
        "//shared/tracer",
        "//shared/tracer/dev",
    ],
)

write_source_files(
    name = "write_tracer_event_data_dynamo_consumed_capacity_keys",
    files = {
        "internal/tracer_event_data_dynamo_consumed_capacity_keys.ts": "//admin/dynamo:tracer_event_data_dynamo_consumed_capacity_keys.ts",
    },
    visibility = ["//admin/dynamo:__pkg__"],
)
