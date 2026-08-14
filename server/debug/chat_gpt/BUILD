load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "chat_gpt",
    visibility = [
        "//app:__pkg__",
        "//server:__subpackages__",
    ],
    deps = [
        "//:node_modules/gpt-tokenizer",
        "//server/debug/shared",
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
