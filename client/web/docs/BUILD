load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "docs",
    visibility = [
        "//app:__subpackages__",
        "//client/web:__subpackages__",
    ],
    deps = [
        "//:node_modules/@remix-run/react",
        "//:node_modules/@types/mdx",
        "//:node_modules/@types/react",
        "//:node_modules/phosphor-react",
        "//:node_modules/react",
        "//:node_modules/react-aria",
        "//client/web/design",
        "//client/web/helpers",
        "//client/web/icons",
        "//client/web/styles",
        "//shared/design",
        "//shared/docs",
        "//shared/helpers",
    ],
)
