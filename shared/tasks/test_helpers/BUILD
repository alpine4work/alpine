load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "test_helpers",
    testonly = True,
    test_deps = [
        "//:node_modules/prosemirror-state",
        "//:node_modules/prosemirror-transform",
        "//:node_modules/prosemirror-view",
        "//:node_modules/prosemirror-model",
        "//:node_modules/yjs",
        "//:node_modules/y-prosemirror",
    ],
    visibility = ["//visibility:public"],
    deps = [
        "//:node_modules/@internationalized/date",
        "//:node_modules/@types/node",
        "//:node_modules/chalk",
        "//shared/helpers",
        "//shared/tasks",
        "//shared/test_helpers",
    ],
)
