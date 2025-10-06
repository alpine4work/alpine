load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "reactions",
    visibility = [
        "//app:__subpackages__",
        "//client:__subpackages__",
    ],
    deps = [
        "//:node_modules/@types/react",
        "//:node_modules/motion",
        "//:node_modules/phosphor-react",
        "//:node_modules/react",
        "//client/accounts",
        "//client/content",
        "//client/design",
        "//client/helpers",
        "//client/navigation",
        "//client/reactions/icons",
        "//client/remix",
        "//client/rpc",
        "//client/spaces",
        "//client/styles",
        "//shared/design",
        "//shared/error",
        "//shared/helpers",
        "//shared/id",
        "//shared/schema",
    ],
)
