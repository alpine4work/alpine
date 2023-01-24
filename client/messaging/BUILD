load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "messaging",
    visibility = [
        "//app:__subpackages__",
        "//client:__subpackages__",
    ],
    deps = [
        "//:node_modules/@types/jest",
        "//:node_modules/@types/react",
        "//:node_modules/react",
        "//client/accounts",
        "//client/content",
        "//client/virtualized",
        "//shared/helpers",
        "//shared/models",
        "//shared/remix",
    ],
)
