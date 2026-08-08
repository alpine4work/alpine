load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "context",
    test_deps = ["//shared/spaces/test_helpers"],
    visibility = [
        "//app:__subpackages__",
        "//client/web:__subpackages__",
    ],
    deps = [
        "//:node_modules/@types/react",
        "//:node_modules/react",
        "//:node_modules/react-aria",
        "//shared/dynamo",
        "//shared/id",
        "//shared/notifications",
    ],
)
