load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "content",
    test_deps = ["//shared/documents"],
    visibility = ["//visibility:public"],
    deps = [
        "//:node_modules/@vanilla-extract/dynamic",
        "//:node_modules/classnames",
        "//:node_modules/phosphor-react",
        "//:node_modules/prosemirror-model",
        "//:node_modules/prosemirror-transform",
        "//:node_modules/unicode-default-word-boundary",
        "//shared/accounts",
        "//shared/context",
        "//shared/design",
        "//shared/files",
        "//shared/helpers",
        "//shared/prosemirror",
        "//shared/schema",
        "//shared/spaces",
    ],
)
