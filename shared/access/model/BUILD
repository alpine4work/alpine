load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "model",
    test_deps = ["//:node_modules/immer"],
    visibility = ["//visibility:public"],
    deps = [
        "//shared/access",
        "//shared/crdt",
        "//shared/id",
        "//shared/helpers",
        "//shared/schema",
        "//shared/sites",
    ],
)
