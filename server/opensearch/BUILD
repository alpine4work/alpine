load("//admin/typescript:typescript.bzl", "ts_project")
load("//server/opensearch:opensearch_visibility.bzl", "OPENSEARCH_VISIBILITY")

ts_project(
    name = "opensearch",
    visibility = [
        "{}:__pkg__".format(label)
        for label in OPENSEARCH_VISIBILITY
    ] + [
        "//admin/crawl:__pkg__",
        "//admin/opensearch:__subpackages__",
        "//app:__pkg__",
        "//server/dynamo/test_helpers:__pkg__",
    ],
    deps = [
        "//:node_modules/@types/json-bigint",
        "//:node_modules/@types/json-stable-stringify",
        "//:node_modules/json-bigint",
        "//:node_modules/json-stable-stringify",
        "//:node_modules/murmurhash",
        "//:node_modules/stemmer",
        "//:node_modules/unicode-default-word-boundary",
        "//server/helpers",
        "//server/helpers/node",
        "//shared/context",
        "//shared/error",
        "//shared/helpers",
        "//shared/id",
        "//shared/opensearch",
        "//shared/schema",
    ],
)
