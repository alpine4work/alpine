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
        "//:node_modules/react",
        "//admin/external_types:sqlite",
        "//client/web/design",
        "//client/web/helpers",
        "//client/web/styles",
        "//client/web/web_socket",
        "//shared/databases",
        "//shared/error",
        "//shared/helpers",
        "//shared/id",
        "//shared/schema",
    ],
)
