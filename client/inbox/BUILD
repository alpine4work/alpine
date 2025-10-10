load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "inbox",
    visibility = [
        "//app:__subpackages__",
        "//client:__subpackages__",
    ],
    deps = [
        "//:node_modules/@types/react",
        "//:node_modules/date-fns",
        "//:node_modules/motion",
        "//:node_modules/react",
        "//:node_modules/react-aria",
        "//client/content",
        "//client/context",
        "//client/design",
        "//client/dynamo",
        "//client/navigation",
        "//client/peek",
        "//client/spaces",
        "//client/virtualized",
        "//shared/helpers",
        "//shared/notifications",
    ],
)
