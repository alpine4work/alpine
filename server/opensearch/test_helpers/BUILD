load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "test_helpers",
    testonly = True,
    visibility = [
        "//server:__subpackages__",
    ],
    deps = [
        "//:node_modules/@types/fs-extra",
        "//:node_modules/fs-extra",
        "//:node_modules/get-port",
        "//admin/helpers",
        "//admin/opensearch/local",
        "//server/dynamo/test_helpers/shared",
        "//shared/helpers",
        "//shared/tracer",
    ],
)
