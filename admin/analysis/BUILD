load("@aspect_rules_js//js:defs.bzl", "js_binary")
load("//admin/typescript:typescript.bzl", "ts_lint_and_format_test")

ts_lint_and_format_test(
    name = "analysis",
)

MERGE_JEST_COVERAGE_DEPS = [
    "//:node_modules/fflate",
    "//:node_modules/istanbul-lib-coverage",
    "//:node_modules/istanbul-lib-instrument",
    "//:node_modules/istanbul-lib-report",
    "//:node_modules/istanbul-reports",
    "//:node_modules/yargs",
]

REPORT_UNCOVERED_LINES_DEPS = [
    "//:node_modules/istanbul-lib-coverage",
    "//:node_modules/yargs",
]

js_binary(
    name = "collect_ci_jest_coverage",
    data = [
        "coverage_source_file.cjs",
        "merge_jest_coverage.cjs",
        "//:node_modules",
    ],
    entry_point = "collect_ci_jest_coverage.cjs",
)

js_binary(
    name = "dev_coverage",
    data = MERGE_JEST_COVERAGE_DEPS + [
        "coverage_source_file.cjs",
        "merge_jest_coverage.cjs",
        "report_uncovered_lines.cjs",
    ],
    entry_point = "dev_coverage_main.cjs",
)

js_binary(
    name = "merge_jest_coverage",
    data = MERGE_JEST_COVERAGE_DEPS + [
        "coverage_source_file.cjs",
    ],
    entry_point = "merge_jest_coverage.cjs",
)

js_binary(
    name = "report_uncovered_lines",
    data = REPORT_UNCOVERED_LINES_DEPS + [
        "coverage_source_file.cjs",
    ],
    entry_point = "report_uncovered_lines.cjs",
)

js_binary(
    name = "publish_analysis_html",
    data = glob(["site/**"]) + ["//:node_modules"],
    entry_point = "publish_analysis_html.cjs",
)
