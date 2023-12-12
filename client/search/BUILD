load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "search",
    visibility = [
        "//app:__subpackages__",
        "//client:__subpackages__",
    ],
    deps = [
        "//:node_modules/@types/react",
        "//:node_modules/react",
        "//:node_modules/unicode-default-word-boundary",
        "//client/accounts",
        "//client/context",
        "//client/design",
        "//client/rpc",
        "//shared/accounts",
        "//shared/error",
        "//shared/helpers",
        "//shared/rpc",
        "//shared/spaces",
    ],
)
