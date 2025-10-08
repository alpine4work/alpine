load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "avatar",
    visibility = [
        "//app:__subpackages__",
        "//client:__subpackages__",
    ],
    deps = [
        "//:node_modules/phosphor-react",
        "//:node_modules/react",
        "//:node_modules/react-aria",
        "//client/design",
        "//client/reactions/icons",
        "//client/styles",
        "//shared/avatar",
        "//shared/error",
    ],
)
