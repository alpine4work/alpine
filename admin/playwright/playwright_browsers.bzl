"""
Repository rule for installing the browsers Playwright needs to execute tests.
"""

load("@aspect_bazel_lib//lib:repo_utils.bzl", "repo_utils")

def _playwright_browsers_repository_impl(rctx):
    node_bin = rctx.path(Label("@node_{}//:bin/node".format(repo_utils.platform(rctx))))

    rctx.extract(rctx.path(Label("@npm__playwright-core__{}//:package.tgz".format(rctx.attr.playwright_version))), "playwright-core", "package")

    # Playwright has no dependencies so we don't need to do any `node_modules`
    # installation. Magical!
    playwright_cli = rctx.path("playwright-core/cli.js")

    exec_result = rctx.execute(
        [
            node_bin,
            playwright_cli,
            "install",
        ],
        environment = {
            "PLAYWRIGHT_BROWSERS_PATH": "{}/browsers".format(rctx.path(".")),
        },
    )

    if exec_result.return_code != 0:
        fail("\"playwright\" exited with code {} (stdout and stderr included for debugging)\n\nstdout:\n{}\n\nstderr:\n{}".format(
            exec_result.return_code,
            exec_result.stdout,
            exec_result.stderr,
        ))

    rctx.file("BUILD", """\
exports_files(["browsers"])
""", executable = False)

playwright_browsers_repository = repository_rule(
    _playwright_browsers_repository_impl,
    attrs = {
        "playwright_version": attr.string(),
    },
)
