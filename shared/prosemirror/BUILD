load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "prosemirror",
    visibility = ["//visibility:public"],
    deps = [
        "//:node_modules/prosemirror-model",
        "//:node_modules/prosemirror-state",
        "//shared/error",
        "//shared/schema",
    ],
)
