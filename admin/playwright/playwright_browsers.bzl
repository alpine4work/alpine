"""
Repository rule for installing the browsers Playwright needs to execute tests.
"""

load("@aspect_bazel_lib//lib:repo_utils.bzl", "repo_utils")

def _playwright_browsers_repository_impl(rctx):
    node_bin = rctx.path(Label("@node_{}//:bin/node".format(repo_utils.platform(rctx))))

    # Playwright has no dependencies so we don't need to do any `node_modules`
    # installation. Magical!
    playwright_cli = rctx.path(Label("@npm__playwright-core__{}//:package/cli.js".format(rctx.attr.playwright_version)))

    # This will globally install dependencies necessary to run our browsers.
    # Necessary for CI.
    rctx.execute(
        [
            node_bin,
            playwright_cli,
            "install-deps",
        ],
        environment = {
            "PLAYWRIGHT_BROWSERS_PATH": "{}/browsers".format(rctx.path(".")),
        },
    )

    rctx.execute(
        [
            node_bin,
            playwright_cli,
            "install",
        ],
        environment = {
            "PLAYWRIGHT_BROWSERS_PATH": "{}/browsers".format(rctx.path(".")),
        },
    )

    rctx.file("BUILD", """\
exports_files(["browsers"])
""", executable = False)

playwright_browsers_repository = repository_rule(
    _playwright_browsers_repository_impl,
    attrs = {
        "playwright_version": attr.string(),
    },
)
