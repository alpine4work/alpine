"""
Rule that copies a `package_light.json` file in the source directory to
`package.json` in the output directory. This allows relevant metadata in
`package.json` to be available in an output directory we use to execute code.
For example `"type": "module"` which tells Node.js to execute code as
ES Modules.

By using `package_light.json` our Bazel packages will not need to be rebuilt
whenever any dependency is changed.

`package_light.json` has a couple dependencies copied from `package.json`.
These are dependency versions that the Remix compiler or some eslint
plugins need.
"""

load("@aspect_bazel_lib//lib:copy_file.bzl", "copy_file_action")

def _package_light_json_impl(ctx):
    file = ctx.actions.declare_file("package.json", sibling = ctx.file.src)
    copy_file_action(ctx, ctx.file.src, file)

    return DefaultInfo(
        files = depset([file]),
        runfiles = ctx.runfiles(files = [file]),
    )

_package_light_json = rule(
    implementation = _package_light_json_impl,
    provides = [DefaultInfo],
    attrs = {
        "src": attr.label(mandatory = True, allow_single_file = True),
    },
)

def package_light_json(**kwargs):
    _package_light_json(
        name = "package_light_json_file",
        src = "package_light.json",
        **kwargs
    )
