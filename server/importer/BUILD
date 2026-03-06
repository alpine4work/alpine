load("//admin/typescript:typescript.bzl", "ts_project")

# Base importer library with context modules and shared utilities.
# This is depended on by //server/importer/notion, so it must not depend on notion.
ts_project(
    name = "importer",
    test_data = [
        "//server/importer/notion:test_fixtures/Workspace-Flat.zip",
    ],
    test_deps = [
        "//:node_modules/@smithy/types",
        "//:node_modules/fflate",
        "//server/importer/development",
        "//server/importer/notion/test_helpers",
        "//shared/tracer/dev",
    ],
    visibility = [
        "//admin:__subpackages__",
        "//app:__subpackages__",
        "//server:__subpackages__",
    ],
    deps = [
        "//:node_modules/@aws-sdk/client-ecs",
        "//:node_modules/@aws-sdk/client-s3",
        "//:node_modules/@aws-sdk/s3-request-presigner",
        "//:node_modules/@types/yauzl",
        "//:node_modules/env-paths",
        "//:node_modules/yauzl",
        "//server/context",
        "//server/helpers",
        "//server/helpers/node",
        "//shared/context",
        "//shared/error",
        "//shared/helpers",
        "//shared/id",
        "//shared/importer",
    ],
)
