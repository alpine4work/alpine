load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "helpers",
    test_deps = ["//:node_modules/expect-type"],
    visibility = ["//visibility:public"],
    deps = [
        "//:node_modules/@types/functional-red-black-tree",
        "//:node_modules/date-fns",
        "//:node_modules/functional-red-black-tree",
        "//shared/error:error_core",
    ],
)
