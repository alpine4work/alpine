load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "layout",
    visibility = [
        "//app:__subpackages__",
        "//client:__subpackages__",
    ],
    deps = [
        "//:node_modules/@types/react",
        "//:node_modules/phosphor-react",
        "//:node_modules/react",
        "//client/accounts",
        "//client/context",
        "//client/design",
        "//client/dynamo",
        "//client/inbox",
        "//client/navigation",
        "//client/remix",
        "//client/search",
        "//client/shimmer",
        "//client/spaces",
        "//client/styles",
        "//shared/design",
        "//shared/dynamo",
        "//shared/error",
        "//shared/helpers",
        "//shared/id",
        "//shared/rpc",
    ],
)
