"""
A test that runs TypeScript and eslint (with type checking enabled) over our
entire workspace.

This test has the same configuration as TypeScript running in an IDE. IDEs
don't know about our Bazel package layout and assume our repository is one big
TypeScript project. This test makes sure we catch any TypeScript errors that
might show up in an IDE but not in our normal package-by-package type checking.

This test also runs eslint rules that require type checking. Since we've
already performed a full TypeScript type check we can reuse the TypeScript
`Program` object when running eslint. We've found running eslint rules that
require type checking on a package-by-package level is quite inefficient since
the eslint result is invalidated whenever a dependency changes. This is an
issue since running eslint is expensive (requiring all the plugins takes time,
parsing takes time, running type checking again takes time).

So to recap we have a test that runs TypeScript against our entire workspace
because:

1. We want to catch errors that only show in an IDE
2. It's most efficient to run ESLint rules that require type checking across
   the entire codebase
"""

load("@aspect_rules_js//js:providers.bzl", "JsInfo")
load("@aspect_rules_js//npm:providers.bzl", "NpmPackageStoreInfo")
load("//admin/typescript/workspace:workspace_typescript_projects.bzl", "WORKSPACE_TYPESCRIPT_PROJECTS")

def _workspace_typescript_test_impl(ctx):
    runfiles = []

    for target in ctx.attr._config:
        runfiles.append(target[DefaultInfo].files)

    for target in ctx.attr._workspace_typescript_projects:
        runfiles.append(target[OutputGroupInfo].srcs)

        if JsInfo in target:
            runfiles.append(target[JsInfo].transitive_npm_linked_package_files)

        if NpmPackageStoreInfo in target:
            runfiles.append(target[NpmPackageStoreInfo].transitive_files)

    executable = ctx.actions.declare_file("{}.sh".format(ctx.label.name))

    ctx.actions.write(
        executable,
        """#!/bin/bash

admin/typescript/workspace/workspace_test_bin.sh
exit $?
""",
        is_executable = True,
    )

    return DefaultInfo(
        files = depset([executable]),
        executable = executable,
        default_runfiles = ctx.attr._executable[DefaultInfo].default_runfiles.merge(ctx.runfiles(
            files = [executable],
            transitive_files = depset(transitive = runfiles),
        )),
    )

workspace_typescript_test = rule(
    _workspace_typescript_test_impl,
    test = True,
    attrs = {
        "_executable": attr.label(executable = True, cfg = "exec", default = "//admin/typescript/workspace:workspace_test_bin"),
        "_config": attr.label_list(allow_files = True, default = ["//:package.json", "//:tsconfig_files", "//:eslint_config_files"]),
        "_workspace_typescript_projects": attr.label_list(default = WORKSPACE_TYPESCRIPT_PROJECTS),
    },
)
