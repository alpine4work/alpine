load("@aspect_rules_js//js:defs.bzl", "js_binary", "js_run_binary")
load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "sitemap_generate_lib",
    deps = ["//app/sitemap"],
)

js_binary(
    name = "sitemap_generate",
    data = [":sitemap_generate_lib"],
    entry_point = "generate_sitemap_main.js",
)

js_run_binary(
    name = "sitemap_run_generate",
    outs = ["sitemap.xml"],
    tool = ":sitemap_generate",
    visibility = ["//app/sitemap:__pkg__"],
)
