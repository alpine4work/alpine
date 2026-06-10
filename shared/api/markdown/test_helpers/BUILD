load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "test_helpers",
    testonly = True,
    visibility = ["//visibility:public"],
    deps = [
        "//:node_modules/fast-check",
        "//shared/api/content",
        "//shared/api/markdown",
        "//shared/api/specification",
        "//shared/helpers",
        "//shared/id",
        "//shared/tracer",
    ],
)

