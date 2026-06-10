load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "notion",
    visibility = [
        "//app:__subpackages__",
        "//client/web:__subpackages__",
    ],
    deps = [
        "//:node_modules/@react-aria/interactions",
        "//:node_modules/@types/react",
        "//:node_modules/phosphor-react",
        "//:node_modules/react",
        "//client/web/accounts",
        "//client/web/content",
        "//client/web/context",
        "//client/web/design",
        "//client/web/helpers",
        "//client/web/icons",
        "//client/web/remix",
        "//client/web/settings",
        "//client/web/spaces",
        "//client/web/styles",
        "//shared/design",
        "//shared/error",
        "//shared/helpers",
        "//shared/id",
        "//shared/importer/notion",
        "//shared/rpc",
        "//shared/schema",
        "//shared/store",
    ],
)
