load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "models",
    test_deps = ["//:node_modules/expect-type"],
    visibility = ["//visibility:public"],
    deps = [
        "//:node_modules/history",
        "//shared/content",
        "//shared/helpers",
        "//shared/id",
        "//shared/schema",
    ],
)
