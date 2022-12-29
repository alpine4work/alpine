load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "context",
    test_deps = ["//:node_modules/expect-type"],
    visibility = ["//visibility:public"],
    deps = [
        "//:node_modules/@types/jest",
        "//shared/error",
        "//shared/helpers",
        "//shared/tracer",
    ],
)
