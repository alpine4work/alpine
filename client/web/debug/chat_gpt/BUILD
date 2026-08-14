load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "chat_gpt",
    visibility = [
        "//app:__subpackages__",
        "//client/web:__subpackages__",
    ],
    deps = [
        "//:node_modules/@types/react",
        "//:node_modules/openai",
        "//:node_modules/react",
        "//client/web/debug/shared",
        "//shared/debug/chat_gpt",
        "//shared/debug/shared",
        "//shared/schema",
    ],
)
