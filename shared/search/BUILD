load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "search",
    test_deps = [
        "//shared/spaces/test_helpers",
    ],
    visibility = ["//visibility:public"],
    deps = [
        "//:node_modules/fuse.js",
        "//shared/design:design_core",
        "//shared/error:error_core",
        "//shared/helpers",
        "//shared/helpers:helpers_core",
        "//shared/id",
        "//shared/opensearch",
        "//shared/schema",
        "//shared/spaces",
        "//shared/tasks/title",
    ],
)
