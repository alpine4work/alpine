load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "posts",
    visibility = ["//visibility:public"],
    deps = [
        "//:node_modules/prosemirror-model",
        "//shared/content",
        "//shared/helpers",
        "//shared/schema",
    ],
)
