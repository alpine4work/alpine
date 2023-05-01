load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "spaces",
    visibility = [
        "//app:__subpackages__",
        "//client:__subpackages__",
    ],
    deps = [
        "//:node_modules/@types/react",
        "//:node_modules/react",
        "//client/accounts",
        "//client/cloudflare",
        "//client/context",
        "//client/design",
        "//client/dynamo",
        "//client/helpers",
        "//client/peek",
        "//client/rpc",
        "//shared/accounts",
        "//shared/dynamo",
        "//shared/helpers",
        "//shared/models",
        "//shared/rpc",
    ],
)
