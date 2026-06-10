load("//admin/typescript:typescript.bzl", "ts_project")
load("//server/dynamo/core:dynamo_core_visibility.bzl", "DYNAMO_CORE_VISIBILITY")

ts_project(
    name = "rynamo",
    test_deps = [
        "//server/dynamo/test_helpers",
        "//server/spaces/test_helpers",
    ],
    # All packages in `DYNAMO_CORE_VISIBILITY` also may access `rynamo`.
    # Since these packages are already being scanned for DynamoDB tables.
    visibility = [
        "{}:__pkg__".format(label)
        for label in DYNAMO_CORE_VISIBILITY
    ] + [
        "//admin/crawl:__pkg__",
    ],
    deps = [
        "//:node_modules/date-fns",
        "//server/context",
        "//server/dynamo/core",
        "//server/notifications/core",
        "//shared/dynamo",
        "//shared/error",
        "//shared/helpers",
        "//shared/id",
        "//shared/schema",
    ],
)
