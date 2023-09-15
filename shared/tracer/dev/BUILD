load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "dev",
    visibility = ["//visibility:public"],
    deps = [
        "//:node_modules/@types/fs-extra",
        "//:node_modules/@types/node",
        "//:node_modules/env-paths",
        "//:node_modules/fs-extra",
        "//shared/helpers",
        "//shared/tracer",
    ],
)
