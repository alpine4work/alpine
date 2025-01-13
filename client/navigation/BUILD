load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "navigation",
    visibility = [
        "//app:__subpackages__",
        "//client:__subpackages__",
    ],
    deps = [
        "//:node_modules/@types/react",
        "//:node_modules/@types/react-dom",
        "//:node_modules/motion",
        "//:node_modules/phosphor-react",
        "//:node_modules/react",
        "//:node_modules/react-dom",
        "//client/accounts",
        "//client/design",
        "//client/helpers",
        "//client/icons",
        "//client/remix",
        "//client/shimmer",
        "//client/spaces",
        "//client/styles",
        "//shared/access",
        "//shared/design",
        "//shared/error",
        "//shared/helpers",
        "//shared/id",
        "//shared/schema",
        "//shared/spaces",
    ],
)
