load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "chat_gpt",
    visibility = ["//visibility:public"],
    deps = [
        "//:node_modules/openai",
        "//shared/error",
        "//shared/helpers",
        "//shared/schema",
    ],
)
