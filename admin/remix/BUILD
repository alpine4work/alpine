load("@aspect_rules_js//js:defs.bzl", "js_binary")

js_binary(
    name = "remix_compiler",
    data = [
        "//:node_modules/@bazel/worker",
        "//:node_modules/@remix-run/dev",
    ],
    entry_point = "remix-compiler.js",
    visibility = ["//:__pkg__"],
)
