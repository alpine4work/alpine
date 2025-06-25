load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "title",
    test_deps = ["//shared/tasks/test_helpers"],
    visibility = ["//visibility:public"],
    deps = [
        "//:node_modules/prosemirror-model",
        "//:node_modules/y-prosemirror",
        "//:node_modules/yjs",
        "//shared/helpers",
        "//shared/id",
        "//shared/schema",
    ],
)
