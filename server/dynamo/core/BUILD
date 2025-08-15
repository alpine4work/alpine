load("@aspect_bazel_lib//lib:write_source_files.bzl", "write_source_files")
load("//admin/typescript:typescript.bzl", "ts_project")
load("//server/dynamo/core:dynamo_core_visibility.bzl", "DYNAMO_CORE_VISIBILITY")

ts_project(
    name = "core",
    test_deps = ["//:node_modules/expect-type"],
    visibility = [
        "{}:__pkg__".format(label)
        for label in DYNAMO_CORE_VISIBILITY
    ] + [
        "//admin/crawl:__pkg__",
        "//server/dynamo/core:__subpackages__",
        "//server/dynamo/test_helpers:__pkg__",
        "//server/spaces/test_helpers:__pkg__",
    ],
    deps = [
        "//:node_modules/@aws-sdk/client-dynamodb",
        "//:node_modules/@types/json-stable-stringify",
        "//:node_modules/@types/node",
        "//:node_modules/json-stable-stringify",
        "//:node_modules/murmurhash",
        "//server/emails",
        "//server/helpers/node",
        "//server/tracer",
        "//shared/context",
        "//shared/design",
        "//shared/dynamo",
        "//shared/error",
        "//shared/helpers",
        "//shared/id",
        "//shared/schema",
        "//shared/tracer",
    ],
)

write_source_files(
    name = "write_dynamo_schema_description",
    files = {
        "internal/dynamo_generated_schema_description.ts": "//admin/dynamo:dynamo_schema_description.ts",
    },
    visibility = ["//admin/dynamo:__pkg__"],
)
