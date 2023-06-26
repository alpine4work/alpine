load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "tasks",
    visibility = ["//visibility:public"],
    deps = [
        "//:node_modules/@internationalized/date",
        "//:node_modules/prosemirror-model",
        "//shared/accounts",
        "//shared/content",
        "//shared/error",
        "//shared/helpers",
        "//shared/id",
        "//shared/prosemirror",
        "//shared/schema",
    ],
)
