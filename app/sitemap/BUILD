load("@aspect_bazel_lib//lib:write_source_files.bzl", "write_source_files")
load("@aspect_rules_js//js:defs.bzl", "js_library")
load("//admin/typescript:typescript.bzl", "ts_project")

js_library(
    name = "production_sitemap",
    srcs = ["sitemap.xml"],
    visibility = ["//app:__pkg__"],
)

ts_project(
    name = "sitemap",
    data = ["//client/web/docs:docs_generated"],
    visibility = [
        "//app:__pkg__",
        "//app/sitemap/generate:__pkg__",
    ],
    deps = [
        "//:node_modules/@types/node",
        "//client/web/auth",
        "//client/web/docs",
        "//server/helpers/node",
    ],
)

write_source_files(
    name = "write_sitemap",
    files = {"sitemap.xml": "//app/sitemap/generate:sitemap.xml"},
)
