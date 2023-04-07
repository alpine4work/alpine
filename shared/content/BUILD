load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "content",
    test_deps = [],
    visibility = ["//visibility:public"],
    deps = [
        "//:node_modules/@vanilla-extract/dynamic",
        "//:node_modules/classnames",
        "//:node_modules/grapheme-splitter",
        "//:node_modules/phosphor-react",
        "//:node_modules/prosemirror-model",
        "//:node_modules/prosemirror-transform",
        "//shared/design",
        "//shared/helpers",
        "//shared/prosemirror",
        "//shared/schema",
        "//shared/styles",
    ],
)
