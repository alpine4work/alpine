load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "inbox",
    test_deps = ["//shared/spaces/test_helpers"],
    visibility = [
        "//app:__subpackages__",
        "//client/web:__subpackages__",
    ],
    deps = [
        "//:node_modules/@types/react",
        "//:node_modules/date-fns",
        "//:node_modules/motion",
        "//:node_modules/react",
        "//:node_modules/react-aria",
        "//client/web/content",
        "//client/web/context",
        "//client/web/design",
        "//client/web/dynamo",
        "//client/web/inbox/context",
        "//client/web/navigation",
        "//client/web/peek",
        "//client/web/spaces",
        "//client/web/virtualized",
        "//shared/helpers",
        "//shared/notifications",
    ],
)
