load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "spaces",
    visibility = [
        "//app:__subpackages__",
        "//client:__subpackages__",
    ],
    deps = [
        "//:node_modules/@types/react",
        "//:node_modules/@types/scheduler",
        "//:node_modules/phosphor-react",
        "//:node_modules/react",
        "//:node_modules/react-router",
        "//client/avatar",
        "//client/design",
        "//client/dev",
        "//client/helpers",
        "//client/styles",
        "//client/web_socket",
        "//shared/accounts",
        "//shared/design",
        "//shared/error",
        "//shared/helpers",
        "//shared/notifications",
        "//shared/remix",
        "//shared/spaces",
        "//shared/store",
    ],
)
