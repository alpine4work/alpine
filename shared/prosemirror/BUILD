load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "prosemirror",
    test_deps = [
        "//:node_modules/fast-check",
        "//:node_modules/prettier",
        "//:node_modules/prosemirror-schema-basic",
        "//shared/content",
        "//shared/documents",
        "//shared/forum",
        "//shared/prosemirror/test_helpers",
    ],
    visibility = ["//visibility:public"],
    deps = [
        "//:node_modules/@types/escape-html",
        "//:node_modules/escape-html",
        "//:node_modules/html-tags",
        "//:node_modules/prosemirror-model",
        "//:node_modules/prosemirror-state",
        "//:node_modules/prosemirror-transform",
        "//:node_modules/unicode-default-word-boundary",
        "//shared/error",
        "//shared/schema",
    ],
)
