load("@aspect_rules_js//js:defs.bzl", "js_binary", "js_run_binary")
load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "dynamo",
    deps = [
        "//admin/crawl",
        "//admin/helpers",
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
        "tracer_event_data_dynamo.ts",
    ],
    args = [
        "--dynamoSchemaDescriptionPath=$(rootpath dynamo_schema_description.ts)",
        "--tracerEventDataDynamoPath=$(rootpath tracer_event_data_dynamo.ts)",
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
        "//server/tracer:write_tracer_event_data_dynamo",
    ],
    deps = ["@bazel_tools//tools/bash/runfiles"],
)
