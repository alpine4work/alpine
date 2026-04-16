load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "reactions",
    visibility = ["//visibility:public"],
    test_deps = ["//:node_modules/@jest/globals"],
    deps = [
        "//shared/helpers",
        "//shared/id",
        "//shared/schema",
    ],
)
