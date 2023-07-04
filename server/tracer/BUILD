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
        "//shared/error",
        "//shared/helpers",
        "//shared/schema",
        "//shared/tracer",
    ],
)

write_source_files(
    name = "write_tracer_event_data_dynamo_consumed_capacity_keys",
    files = {
        "internal/tracer_event_data_dynamo_consumed_capacity_keys.ts": "//admin/dynamo:tracer_event_data_dynamo_consumed_capacity_keys",
    },
    visibility = ["//admin/dynamo:__pkg__"],
)
