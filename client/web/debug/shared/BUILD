load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "shared",
    visibility = [
        "//app:__subpackages__",
        "//client/web:__subpackages__",
    ],
    deps = [
        "//:node_modules/@types/react",
        "//:node_modules/react",
        "//:node_modules/react-aria",
        "//client/web/design",
        "//client/web/helpers",
        "//client/web/styles",
        "//shared/debug/shared",
        "//shared/design",
        "//shared/helpers",
    ],
)
