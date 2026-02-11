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
        "//:node_modules/fs-extra",
        "//server/helpers",
        "//server/kinesis",
        "//shared/context",
        "//shared/error",
        "//shared/helpers",
        "//shared/id",
        "//shared/schema",
        "//shared/tracer",
        "//shared/tracer/dev",
    ],
)

write_source_files(
    name = "write_tracer_event_data_dynamo",
    files = {
        "tracer_event_data_dynamo.ts": "//admin/dynamo:tracer_event_data_dynamo.ts",
    },
    visibility = ["//admin/dynamo:__pkg__"],
)
