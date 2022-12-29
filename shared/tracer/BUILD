load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "tracer",
    test_deps = ["//:node_modules/expect-type"],
    visibility = ["//visibility:public"],
    deps = [
        "//shared/error",
        "//shared/helpers",
        "//shared/id",
        "//shared/schema",
    ],
)
