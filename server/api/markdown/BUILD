load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "markdown",
    test_deps = [
        "//:node_modules/fast-check",
        "//:node_modules/gpt-tokenizer",
    ],
    visibility = ["//server:__subpackages__"],
    # IMPORTANT: We try to keep the first-party dependency list for this markdown
    # parser/printer pretty small. We'd like to open source this code someday! So
    # instead of requesting markdown from our API a developer could run the
    # markdown printer directly on whatever content they're working with. If
    # they're writing code in Node.js. If can also work as a reference
    # specification for "Alpine flavored markdown".
    deps = [
        "//:node_modules/@types/escape-html",
        "//:node_modules/@types/mdast",
        "//:node_modules/escape-html",
        "//:node_modules/htmlparser2",
        "//:node_modules/immer",
        "//:node_modules/mdast-util-from-markdown",
        "//:node_modules/mdast-util-frontmatter",
        "//:node_modules/mdast-util-gfm-strikethrough",
        "//:node_modules/mdast-util-gfm-table",
        "//:node_modules/mdast-util-gfm-task-list-item",
        "//:node_modules/mdast-util-math",
        "//:node_modules/mdast-util-to-markdown",
        "//:node_modules/micromark-extension-frontmatter",
        "//:node_modules/micromark-extension-gfm-strikethrough",
        "//:node_modules/micromark-extension-gfm-table",
        "//:node_modules/micromark-extension-gfm-task-list-item",
        "//:node_modules/micromark-extension-math",
        "//server/api/specification",
        "//shared/helpers",
        "//shared/id",
    ],
)
