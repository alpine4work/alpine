load("@npm//:wrangler/package_json.bzl", wrangler_bin = "bin")
load("//admin/typescript:typescript.bzl", "ts_lint_and_format_test")

wrangler_bin.wrangler_binary(
    name = "wrangler_dev",
    args = [
        "--compatibility-date=2025-02-20",
        "dev",
    ],
    chdir = package_name(),
    data = [
        "dev_domain_service.ts",
        "wrangler.toml",
    ],
)

wrangler_bin.wrangler_binary(
    name = "wrangler_deploy",
    args = ["deploy"],
    chdir = package_name(),
    data = [
        "dev_domain_service.ts",
        "wrangler.toml",
    ],
)

ts_lint_and_format_test(
    name = "dev_domain",
)
