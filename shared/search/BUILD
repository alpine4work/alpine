load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "search",
    visibility = ["//visibility:public"],
    deps = [
        "//:node_modules/fuse.js",
        "//shared/accounts",
        "//shared/design",
        "//shared/error",
        "//shared/id",
        "//shared/opensearch",
        "//shared/schema",
        "//shared/spaces",
        "//shared/tasks/title",
    ],
)
