load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "reactions",
    visibility = [
        "//app:__subpackages__",
        "//client/web:__subpackages__",
    ],
    deps = [
        "//:node_modules/@types/react",
        "//:node_modules/motion",
        "//:node_modules/phosphor-react",
        "//:node_modules/react",
        "//client/web/accounts",
        "//client/web/content",
        "//client/web/design",
        "//client/web/helpers",
        "//client/web/navigation",
        "//client/web/reactions/icons",
        "//client/web/remix",
        "//client/web/rpc",
        "//client/web/spaces",
        "//client/web/styles",
        "//shared/design",
        "//shared/error",
        "//shared/helpers",
        "//shared/id",
        "//shared/schema",
    ],
)
