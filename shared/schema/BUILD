load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "schema",
    visibility = ["//visibility:public"],
    deps = [
        "//:node_modules/date-fns",
        "//:node_modules/murmurhash",
        "//:node_modules/typedfastbitset",
        "//shared/error:error_core",
        "//shared/helpers",
        "//shared/id",
    ],
)
