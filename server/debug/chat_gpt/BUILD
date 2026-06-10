load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "chat_gpt",
    visibility = [
        "//app:__pkg__",
        "//server:__subpackages__",
    ],
    deps = [
        "//:node_modules/@lezer/common",
        "//:node_modules/@lezer/highlight",
        "//:node_modules/@lezer/html",
        "//:node_modules/@lezer/json",
        "//:node_modules/@lezer/markdown",
        "//:node_modules/@types/escape-html",
        "//:node_modules/@types/prettier",
        "//:node_modules/escape-html",
        "//:node_modules/gpt-tokenizer",
        "//:node_modules/prettier",
        "//server/remix",
        "//server/spaces",
        "//shared/api/specification",
        "//shared/bots",
        "//shared/content/code",
        "//shared/debug/chat_gpt",
        "//shared/error",
        "//shared/helpers",
        "//shared/id",
        "//shared/schema",
    ],
)
