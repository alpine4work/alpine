load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "eslint",
    deps = [
        "//client/content",
        "//shared/helpers",
        "//shared/id",
    ],
)

filegroup(
    name = "eslint_custom_rules",
    # An empty `rules/package.json` is there so we can use the `.js` extension
    # while our rules are written in CommonJS.
    srcs = ["rules/package.json"] + glob(["rules/*.js"]),
    visibility = ["//visibility:public"],
)
