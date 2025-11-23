load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "dev",
    visibility = [
        "//app:__subpackages__",
        "//client:__subpackages__",
    ],
    deps = [
        "//:node_modules/@types/react",
        "//:node_modules/react",
        "//client/web/helpers",
        "//shared/accounts",
        "//shared/helpers",
        "//shared/id",
        "//shared/schema",
    ],
)
