load("//admin/typescript:typescript.bzl", "ts_lint_and_format_test")

ts_lint_and_format_test(
    name = "docs",
)

# TODO(calebmer): Would love some kind of visualization of this but the default
# `dot` visualization is a total mess! Ideally there'd be server clusters and
# client clusters.
genquery(
    name = "app_js_library_deps.dot",
    expression = "filter(\"^(?!//:\\.aspect_rules_js/).\", kind(\"js_library\", deps(//app:app_lib)))",
    opts = ["--output=graph"],
    scope = ["//app:app_lib"],
)
