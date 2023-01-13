load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "content",
    test_deps = ["//shared/documents"],
    visibility = ["//visibility:public"],
    deps = [
        "//:node_modules/@vanilla-extract/dynamic",
        "//:node_modules/classnames",
        "//:node_modules/prosemirror-model",
        "//shared/design",
        "//shared/helpers",
        "//shared/styles",
    ],
)
