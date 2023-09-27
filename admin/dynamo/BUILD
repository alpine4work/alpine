load("@aspect_rules_js//js:defs.bzl", "js_binary", "js_run_binary")
load("//admin/typescript:typescript.bzl", "ts_project")
load("//server/dynamo/core:dynamo_core_visibility.bzl", "DYNAMO_CORE_VISIBILITY")

ts_project(
    name = "dynamo",
    data = DYNAMO_CORE_VISIBILITY,
    visibility = ["//admin/aws:__pkg__"],
    deps = [
        "//:node_modules/fast-glob",
        "//admin/helpers",
        "//server/dynamo/core",
        "//shared/helpers",
        "//shared/schema",
    ],
)

js_binary(
    name = "generate_dynamo_files",
    data = [":dynamo"],
    entry_point = "generate_dynamo_files_main.js",
    env = {"NODE_ENV": "development"},
)

js_run_binary(
    name = "dynamo_generated_files",
    outs = [
        "dynamo_schema_description.ts",
        "tracer_event_data_dynamo_consumed_capacity_keys.ts",
    ],
    args = [
        "--dynamoSchemaDescriptionPath=$(rootpath dynamo_schema_description.ts)",
        "--tracerEventDataDynamoConsumedCapacityKeysPath=$(rootpath tracer_event_data_dynamo_consumed_capacity_keys.ts)",
    ],
    tool = ":generate_dynamo_files",
    visibility = [
        "//server/dynamo/core:__pkg__",
        "//server/tracer:__pkg__",
    ],
)

sh_binary(
    name = "write_schema",
    srcs = ["dynamo_write_schema.sh"],
    data = [
        "//server/dynamo/core:write_dynamo_schema_description",
        "//server/tracer:write_tracer_event_data_dynamo_consumed_capacity_keys",
    ],
    deps = ["@bazel_tools//tools/bash/runfiles"],
)
