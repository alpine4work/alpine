load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "messaging",
    visibility = [
        "//app:__subpackages__",
        "//client:__subpackages__",
    ],
    deps = [
        "//:node_modules/@internationalized/date",
        "//:node_modules/@types/jest",
        "//:node_modules/@types/react",
        "//:node_modules/functional-red-black-tree",
        "//:node_modules/motion",
        "//:node_modules/react",
        "//client/accounts",
        "//client/content",
        "//client/inbox",
        "//client/peek",
        "//client/spaces",
        "//client/virtualized",
        "//shared/helpers",
        "//shared/messaging",
        "//shared/remix",
    ],
)
