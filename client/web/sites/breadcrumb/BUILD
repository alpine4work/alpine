load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "breadcrumb",
    visibility = [
        "//app:__subpackages__",
        "//client/web:__subpackages__",
    ],
    deps = [
        "//:node_modules/phosphor-react",
        "//:node_modules/react",
        "//client/web/design",
        "//client/web/inbox/context",
        "//client/web/remix",
        "//client/web/sites/context",
        "//client/web/spaces",
        "//client/web/styles",
        "//shared/remix",
        "//shared/search",
        "//shared/sites",
    ],
)
