load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "shared",
    visibility = ["//server:__subpackages__"],
    deps = [
        "//:node_modules/@lezer/highlight",
        "//:node_modules/@lezer/html",
        "//:node_modules/@lezer/json",
        "//:node_modules/@lezer/markdown",
        "//:node_modules/@types/escape-html",
        "//:node_modules/@types/prettier",
        "//:node_modules/escape-html",
        "//:node_modules/prettier",
        "//shared/lezer",
    ],
)
