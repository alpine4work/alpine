load("@aspect_rules_js//js:defs.bzl", "js_binary")
load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "calebmer",
    deps = [
        "//:node_modules/@babel/parser",
        "//:node_modules/@types/node",
        "//shared/helpers",
    ],
)

js_binary(
    name = "sort_reference_graph",
    data = [":calebmer"],
    entry_point = "sort_reference_graph_main.js",
)
