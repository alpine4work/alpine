load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "claude",
    visibility = [
        "//app:__subpackages__",
        "//client/web:__subpackages__",
    ],
    deps = [
        "//:node_modules/@types/react",
        "//:node_modules/react",
        "//:node_modules/react-aria",
        "//client/web/design",
        "//client/web/styles",
        "//shared/debug/claude",
        "//shared/design",
    ],
)
