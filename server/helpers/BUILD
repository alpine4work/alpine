load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "helpers",
    visibility = [
        "//admin:__subpackages__",
        "//app:__subpackages__",
        "//server:__subpackages__",
    ],
    deps = [
        "//:node_modules/@types/cookie",
        "//:node_modules/@types/jest",
        "//:node_modules/@types/json-stable-stringify",
        "//:node_modules/cookie",
        "//:node_modules/json-stable-stringify",
        "//server/tokens",
        "//shared/context",
        "//shared/error",
        "//shared/helpers",
        "//shared/schema",
        "//shared/search",
        "//shared/tracer",
    ],
)
