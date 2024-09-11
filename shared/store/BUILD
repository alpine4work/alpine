load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "store",
    visibility = ["//visibility:public"],
    deps = [
        "//:node_modules/date-fns",
        "//:node_modules/murmurhash",
        "//shared/error:error_core",
        "//shared/helpers",
        "//shared/id",
    ],
)
