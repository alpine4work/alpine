load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "error",
    visibility = [
        "//app:__subpackages__",
        "//client:__subpackages__",
    ],
    deps = [
        "//:node_modules/@remix-run/react",
        "//:node_modules/@types/react",
        "//:node_modules/phosphor-react",
        "//:node_modules/react",
        "//client/context",
        "//client/design",
        "//shared/error",
        "//shared/helpers",
        "//shared/styles",
    ],
)
