load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "design",
    visibility = [
        "//app:__subpackages__",
        "//client:__subpackages__",
    ],
    deps = [
        "//:node_modules/@popperjs/core",
        "//:node_modules/@react-aria/interactions",
        "//:node_modules/@react-types/shared",
        "//:node_modules/@types/react",
        "//:node_modules/@types/react-dom",
        "//:node_modules/classnames",
        "//:node_modules/phosphor-react",
        "//:node_modules/react",
        "//:node_modules/react-aria",
        "//:node_modules/react-dom",
        "//client/context",
        "//client/dev",
        "//client/helpers",
        "//client/remix",
        "//shared/design",
        "//shared/error",
        "//shared/helpers",
        "//shared/styles",
    ],
)
