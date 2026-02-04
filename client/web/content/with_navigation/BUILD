load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "with_navigation",
    visibility = [
        "//app:__subpackages__",
        "//client/web:__subpackages__",
    ],
    deps = [
        "//:node_modules/@types/react",
        "//:node_modules/react",
        "//client/web/content",
        "//client/web/design",
        "//client/web/helpers",
        "//client/web/navigation",
        "//client/web/remix",
        "//client/web/styles",
        "//shared/design",
        "//shared/helpers",
        "//shared/messaging",
    ],
)
