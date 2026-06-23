load("@aspect_rules_js//js:defs.bzl", "js_binary")
load("//admin/typescript:typescript.bzl", "ts_lint_and_format_test")

ts_lint_and_format_test(
    name = "analysis",
)

js_binary(
    name = "collect_ci_jest_coverage",
    data = [
        "merge_jest_coverage.cjs",
        "//:node_modules",
    ],
    entry_point = "collect_ci_jest_coverage.cjs",
)

js_binary(
    name = "dev_coverage",
    data = [
        "merge_jest_coverage.cjs",
        "//:node_modules",
    ],
    entry_point = "dev_coverage_main.cjs",
)

js_binary(
    name = "merge_jest_coverage",
    data = ["//:node_modules"],
    entry_point = "merge_jest_coverage.cjs",
)

js_binary(
    name = "publish_analysis_html",
    data = glob(["site/**"]) + ["//:node_modules"],
    entry_point = "publish_analysis_html.cjs",
)
