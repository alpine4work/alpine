load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "databases",
    visibility = ["//server:__subpackages__"],
    deps = [
        "//:node_modules/@cloudflare/workers-types",
        "@sqlite",
        "//admin/external_types:sqlite",
        "//server/cloudflare",
        "//shared/databases",
        "//shared/error",
        "//shared/helpers",
    ],
)
