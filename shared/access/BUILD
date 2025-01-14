load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "access",
    test_deps = ["//:node_modules/immer"],
    visibility = ["//visibility:public"],
    deps = [
        "//shared/accounts",
        "//shared/crdt",
        "//shared/error",
        "//shared/id",
        "//shared/messaging",
        "//shared/schema",
    ],
)
