load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "avatar",
    visibility = [
        "//client:__subpackages__",
        "//app:__subpackages__",
    ],
    deps = [
        "//:node_modules/phosphor-react",
        "//:node_modules/react",
        "//:node_modules/react-aria",
        "//client/design",
        "//client/styles",
        "//shared/avatar",
        "//shared/error",
    ],
)
