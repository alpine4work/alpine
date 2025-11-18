load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "chat_gpt",
    visibility = [
        "//app:__subpackages__",
        "//client:__subpackages__",
    ],
    deps = [
        "//:node_modules/@types/react",
        "//:node_modules/openai",
        "//:node_modules/react",
        "//:node_modules/react-aria",
        "//client/design",
        "//client/helpers",
        "//client/styles",
        "//shared/debug/chat_gpt",
        "//shared/helpers",
        "//shared/schema",
    ],
)
