load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "prosemirror",
    test_deps = [
        "//:node_modules/prosemirror-schema-basic",
        "//shared/content",
        "//shared/forum",
    ],
    visibility = ["//visibility:public"],
    deps = [
        "//:node_modules/@types/escape-html",
        "//:node_modules/escape-html",
        "//:node_modules/html-tags",
        "//:node_modules/prosemirror-model",
        "//:node_modules/prosemirror-state",
        "//:node_modules/prosemirror-transform",
        "//shared/error",
        "//shared/schema",
    ],
)
