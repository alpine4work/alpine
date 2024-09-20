load("//admin/typescript:typescript.bzl", "ts_project")
load("//server/dynamo/core:dynamo_core_visibility.bzl", "DYNAMO_CORE_VISIBILITY")

ts_project(
    name = "general_realtime",
    # All packages in `DYNAMO_CORE_VISIBILITY` also may access `general_realtime`.
    # Since these packages are already being scanned for DynamoDB tables.
    visibility = [
        "{}:__pkg__".format(label)
        for label in DYNAMO_CORE_VISIBILITY
    ] + [
        "//admin/dynamo:__pkg__",
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
