load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "app",
    visibility = ["//:__pkg__"],
    deps = [
        "//:node_modules/@axe-core/react",
        "//:node_modules/@cloudflare/workers-types",
        "//:node_modules/@remix-run/cloudflare",
        "//:node_modules/@remix-run/dev",
        "//client",
        "//server",
        "//shared",
    ],
)
