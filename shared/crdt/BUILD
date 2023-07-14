load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "crdt",
    visibility = ["//visibility:public"],
    deps = [
        "//:node_modules/@types/json-stable-stringify",
        "//:node_modules/date-fns",
        "//:node_modules/json-stable-stringify",
        "//shared/error",
        "//shared/helpers",
        "//shared/schema",
    ],
)
