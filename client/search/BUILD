load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "search",
    visibility = [
        "//app:__subpackages__",
        "//client/spaces/layout:__pkg__",
    ],
    deps = [
        "//:node_modules/@types/react",
        "//:node_modules/@types/scheduler",
        "//:node_modules/react",
        "//:node_modules/scheduler",
        "//:node_modules/unicode-default-word-boundary",
        "//client/accounts",
        "//client/context",
        "//client/design",
        "//client/peek",
        "//client/rpc",
        "//client/shimmer",
        "//client/spaces",
        "//client/virtualized",
        "//shared/accounts",
        "//shared/error",
        "//shared/helpers",
        "//shared/rpc",
        "//shared/spaces",
    ],
)
