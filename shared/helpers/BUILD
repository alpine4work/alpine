load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "helpers",
    test_deps = ["//:node_modules/expect-type"],
    visibility = ["//visibility:public"],
    deps = [
        "//:node_modules/@types/escape-html",
        "//:node_modules/@types/functional-red-black-tree",
        "//:node_modules/@types/jest",
        "//:node_modules/@types/tough-cookie",
        "//:node_modules/date-fns",
        "//:node_modules/emoji-regex",
        "//:node_modules/escape-html",
        "//:node_modules/functional-red-black-tree",
        "//:node_modules/html-tags",
        "//:node_modules/punycode",  # Needed for `tough-cookie` since it used to be part of Node.js
        "//:node_modules/tough-cookie",
        "//shared/error:error_core",
    ],
)
