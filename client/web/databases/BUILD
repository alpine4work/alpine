load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "databases",
    visibility = [
        "//app:__subpackages__",
        "//client/web:__subpackages__",
    ],
    deps = [
        "@sqlite",
        "//:node_modules/@types/react",
        "//:node_modules/phosphor-react",
        "//:node_modules/react",
        "//admin/external_types:sqlite",
        "//client/web/context",
        "//client/web/design",
        "//client/web/helpers",
        "//client/web/navigation",
        "//client/web/remix",
        "//client/web/spaces",
        "//client/web/styles",
        "//client/web/virtualized",
        "//client/web/web_socket",
        "//shared/databases",
        "//shared/design",
        "//shared/error",
        "//shared/helpers",
        "//shared/id",
        "//shared/rpc",
        "//shared/schema",
        "//shared/store",
    ],
)
