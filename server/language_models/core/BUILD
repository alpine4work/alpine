load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "core",
    visibility = ["//server:__subpackages__"],
    deps = [
        "//:node_modules/@types/node",
        "//:node_modules/@xenova/transformers",
        "//shared/context",
        "//shared/error",
        "//shared/helpers",
    ],
)
