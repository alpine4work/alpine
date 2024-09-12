load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "opensearch",
    visibility = [
        "//admin/opensearch:__subpackages__",
        "//server:__subpackages__",
    ],
    deps = [
        "//:node_modules/@types/json-bigint",
        "//:node_modules/@types/json-stable-stringify",
        "//:node_modules/json-bigint",
        "//:node_modules/json-stable-stringify",
        "//:node_modules/murmurhash",
        "//:node_modules/stemmer",
        "//:node_modules/unicode-default-word-boundary",
        "//server/helpers/node",
        "//shared/context",
        "//shared/error",
        "//shared/helpers",
        "//shared/id",
        "//shared/opensearch",
        "//shared/schema",
    ],
)
