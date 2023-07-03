load("@aspect_rules_js//js:defs.bzl", "js_binary", "js_library", "js_run_binary")
load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "tracer",
    visibility = [
        "//admin:__subpackages__",
        "//app:__subpackages__",
        "//server:__subpackages__",
    ],
    deps = [
        ":tracer_event_data_dynamo_consumed_capacity_keys",
        "//shared/error",
        "//shared/helpers",
        "//shared/schema",
        "//shared/tracer",
    ],
)

# We don't want `//server/tracer` to directly depend on `//server/dynamo` so
# generate a string array file with the keys we need from `//server/dynamo` at
# build time.
js_binary(
    name = "generate_tracer_event_data_dynamo_consumed_capacity_keys",
    data = ["//server/dynamo"],
    entry_point = "internal/generate_tracer_event_data_dynamo_consumed_capacity_keys_main.mjs",
    env = {"NODE_ENV": "development"},
)

js_run_binary(
    name = "tracer_event_data_dynamo_consumed_capacity_keys_file",
    stdout = "internal/tracer_event_data_dynamo_consumed_capacity_keys.js",
    tool = ":generate_tracer_event_data_dynamo_consumed_capacity_keys",
)

js_library(
    name = "tracer_event_data_dynamo_consumed_capacity_keys",
    srcs = [":tracer_event_data_dynamo_consumed_capacity_keys_file"],
)
