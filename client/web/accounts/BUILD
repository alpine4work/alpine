load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "accounts",
    test_deps = ["//:node_modules/@types/node"],
    visibility = [
        "//app:__subpackages__",
        "//client/web:__subpackages__",
    ],
    deps = [
        "//:node_modules/@types/react",
        "//:node_modules/@types/scheduler",
        "//:node_modules/react",
        "//:node_modules/scheduler",
        "//client/web/avatar",
        "//client/web/context",
        "//client/web/design",
        "//client/web/helpers",
        "//client/web/spaces",
        "//shared/accounts",
        "//shared/design",
        "//shared/helpers",
        "//shared/spaces",
    ],
)
