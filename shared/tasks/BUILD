load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "tasks",
    test_deps = [
        "//:node_modules/prosemirror-state",
        "//:node_modules/prosemirror-transform",
    ],
    visibility = ["//visibility:public"],
    deps = [
        "//:node_modules/@internationalized/date",
        "//:node_modules/prosemirror-model",
        "//:node_modules/y-prosemirror",
        "//:node_modules/yjs",
        "//shared/accounts",
        "//shared/content",
        "//shared/error",
        "//shared/helpers",
        "//shared/id",
        "//shared/prosemirror",
        "//shared/schema",
    ],
)
