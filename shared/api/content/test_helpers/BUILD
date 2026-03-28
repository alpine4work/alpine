load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "test_helpers",
    test_deps = [
        "//shared/documents",
        "//shared/prosemirror/test_helpers",
    ],
    visibility = ["//visibility:public"],
    # IMPORTANT: We try to keep the first-party dependency list for this markdown
    # parser/printer pretty small. We'd like to open source this code someday! So
    # instead of requesting markdown from our API a developer could run the
    # markdown printer directly on whatever content they're working with. If
    # they're writing code in Node.js. If can also work as a reference
    # specification for "Alpine flavored markdown".
    deps = [
        "//:node_modules/fast-check",
        "//shared/api/content",
        "//shared/api/content/closed_source",
        "//shared/api/specification",
        "//shared/helpers",
        "//shared/id",
    ],
)
