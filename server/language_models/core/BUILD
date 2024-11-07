load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "core",
    visibility = ["//server/language_models:__subpackages__"],
    deps = [
        "//:node_modules/@types/node",
        "//:node_modules/@xenova/transformers",
        "//server/opensearch",
        "//shared/context",
        "//shared/error",
        "//shared/helpers",
    ],
)
