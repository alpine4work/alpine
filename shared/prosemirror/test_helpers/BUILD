load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    testonly = True,
    name = "test_helpers",
    visibility = ["//visibility:public"],
    deps = [
        "//:node_modules/fast-check",
        "//:node_modules/prosemirror-model",
        "//shared/content",
        "//shared/design",
        "//shared/error",
        "//shared/helpers",
        "//shared/id",
        "//shared/prosemirror",
        "//shared/schema",
    ],
)
