load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "opensearch",
    visibility = [
        "//server/dynamo:__subpackages__",
        "//server/tasks:__subpackages__",
    ],
    deps = [
        "//:node_modules/@opensearch-project/opensearch",
        "//:node_modules/@types/json-bigint",
        "//:node_modules/json-bigint",
        "//server/helpers",
        "//shared/context",
        "//shared/error",
        "//shared/helpers",
        "//shared/id",
        "//shared/schema",
    ],
)
