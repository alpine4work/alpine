load("@aspect_rules_js//js:defs.bzl", "js_binary", "js_run_binary")
load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "dynamo",
    deps = [
        "//admin/helpers",
        "//server/dynamo",
        "//shared/helpers",
        "//shared/schema",
    ],
)

js_binary(
    name = "generate_dynamo_schema_description",
    data = [":dynamo"],
    entry_point = "generate_dynamo_schema_description_main.js",
    env = {"NODE_ENV": "development"},
)

js_run_binary(
    name = "dynamo_schema_description",
    stdout = "dynamo_schema_description.ts",
    tool = ":generate_dynamo_schema_description",
    visibility = ["//server/dynamo:__pkg__"],
)

js_binary(
    name = "generate_tracer_event_data_dynamo_consumed_capacity_keys",
    data = [":dynamo"],
    entry_point = "generate_tracer_event_data_dynamo_consumed_capacity_keys_main.js",
    env = {"NODE_ENV": "development"},
)

js_run_binary(
    name = "tracer_event_data_dynamo_consumed_capacity_keys",
    stdout = "tracer_event_data_dynamo_consumed_capacity_keys.ts",
    tool = ":generate_tracer_event_data_dynamo_consumed_capacity_keys",
    visibility = ["//server/tracer:__pkg__"],
)

sh_binary(
    name = "write_schema",
    srcs = ["write_schema.sh"],
    data = [
        "//server/dynamo:write_dynamo_schema_description",
        "//server/tracer:write_tracer_event_data_dynamo_consumed_capacity_keys",
    ],
    deps = ["@bazel_tools//tools/bash/runfiles"],
)
