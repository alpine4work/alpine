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
        "//:node_modules/@types/scheduler",
        "//:node_modules/react",
        "//:node_modules/scheduler",
        "//client/avatar",
        "//client/context",
        "//client/design",
        "//client/helpers",
        "//client/spaces",
        "//shared/accounts",
        "//shared/helpers",
    ],
)
