load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "accounts",
    visibility = [
        "//visibility:public",
    ],
    deps = [
        "//:node_modules/free-email-domains",
        "//shared/avatar",
        "//shared/bots/owners",
        "//shared/helpers",
        "//shared/id",
        "//shared/reactions",
        "//shared/schema",
    ],
)
