load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "accounts",
    test_deps = ["//:node_modules/@types/node"],
    visibility = [
        "//app:__subpackages__",
        "//client:__subpackages__",
    ],
    deps = [
        "//:node_modules/@types/react",
        "//:node_modules/react",
        "//client/context",
        "//client/design",
        "//shared/helpers",
        "//shared/models",
    ],
)
