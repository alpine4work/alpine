"""
Bazel integration with [Vite's dep optimization][1] functionality. Instead of
using Vite to scan and bundle optimized dependencies we want Bazel to scan and
bundle. This improves build performance since Bazel can build and cache
optimized deps in parallel with other build artifacts.

[1]: https://vitejs.dev/config/dep-optimization-options
"""

load("@aspect_rules_js//js:providers.bzl", "JsInfo")

AppClientOptimizeDepsInfo = provider(
    doc = "The direct node module dependencies of this target",
    fields = {
        "optimize_deps": "Files where each line is a dependency we want to optimize from this target",
        "transitive_optimize_deps": "Our optimized dependencies and the optimized dependencies of all our dependencies transitively",
        "client_transitive_optimize_deps": "Our optimized dependencies and the optimized dependencies of all our dependencies transitively but only from client packages (and their dependencies)",
    },
)

# Regular expression that parses external JavaScript imports. It ignores
# imports that start with a `~` or `.` since these imports represent local file
# imports. This regular expression is dumber than a full JavaScript parser. It
# doesn't ignore imports in comments but it gets the job done.
IMPORT_REG_EXP = """(?:import +(?:(?:\\{[^}]*\\}|[^ ]+|\\* +as +[^ ]+) +from +)?(?:"([^~.][^"]*)"|'([^~.][^']*)')|import\\([^)]*?(?:"([^~.][^"]*)"|'([^~.][^']*)')[^)]*?\\))"""

def _app_client_optimize_deps_aspect_impl(target, ctx):
    optimize_deps = []
    transitive_optimize_deps = []
    client_transitive_optimize_deps = []

    # Only collect dependencies for `js_library()` rules. This excludes
    # dependencies of build tools (e.g. esbuild) that output a `JsInfo` but whose
    # `deps` are build dependencies not runtime dependencies.
    if ctx.rule.kind == "js_library" or ctx.rule.kind == "ts_project":
        if hasattr(ctx.rule.attr, "deps"):
            for dep in ctx.rule.attr.deps:
                if AppClientOptimizeDepsInfo in dep:
                    transitive_optimize_deps.append(dep[AppClientOptimizeDepsInfo].transitive_optimize_deps)
                    client_transitive_optimize_deps.append(dep[AppClientOptimizeDepsInfo].client_transitive_optimize_deps)

        if JsInfo in target:
            for input in target[JsInfo].sources.to_list():
                if input.extension == "map":
                    continue

                output = ctx.actions.declare_file("{}.optimize_deps".format(input.basename), sibling = input)

                ctx.actions.run_shell(
                    inputs = [input],
                    outputs = [output],
                    tools = [ctx.executable._node],
                    command = """\
'{node}' --eval 'const fs = require("fs"); const input = fs.readFileSync("{input}", "utf8"); const matches = input.matchAll(/{regex}/g); for (const match of matches) process.stdout.write((match[1] ?? match[2] ?? match[3] ?? match[4]) + "\\n");' | sort | uniq > '{output}'\
""".format(
                        node = ctx.executable._node.path,
                        input = input.path,
                        output = output.path,
                        regex = IMPORT_REG_EXP.replace("'", "'\\''"),
                    ),
                    mnemonic = "ScanJsDeps",
                    # This action is pretty simple. We trust it to be hermetic. So to improve
                    # performance don't use a sandbox.
                    execution_requirements = {"no-sandbox": "1"},
                )

                optimize_deps.append(output)

    merged_optimize_deps = ctx.actions.declare_file("{}.optimize_deps".format(target.label.name))

    ctx.actions.run_shell(
        inputs = optimize_deps,
        outputs = [merged_optimize_deps],
        command = "cat {inputs} | sort | uniq > '{output}'".format(
            inputs = " ".join(["'{}'".format(input.path) for input in optimize_deps]),
            output = merged_optimize_deps.path,
        ),
        # This action is pretty simple. We trust it to be hermetic. So to improve
        # performance don't use a sandbox.
        execution_requirements = {"no-sandbox": "1"},
    )

    optimize_deps = [merged_optimize_deps]

    transitive_optimize_deps = depset(
        optimize_deps,
        transitive = transitive_optimize_deps,
    )

    return AppClientOptimizeDepsInfo(
        optimize_deps = optimize_deps,
        transitive_optimize_deps = transitive_optimize_deps,

        # If this is a client package, include ALL transitive node module dependencies.
        # Otherwise, only include accumulated client dependencies.
        client_transitive_optimize_deps = transitive_optimize_deps if (
            target.label.repo_name == "" and
            target.label.package.startswith("client/web/")
        ) else depset(
            transitive = client_transitive_optimize_deps,
        ),
    )

app_client_optimize_deps_aspect = aspect(
    _app_client_optimize_deps_aspect_impl,
    attr_aspects = ["deps"],
    attrs = {
        "_node": attr.label(
            default = "//:node",
            cfg = "exec",
            executable = True,
            allow_single_file = True,
        ),
    },
    provides = [AppClientOptimizeDepsInfo],
)

def _app_client_optimize_deps_impl(ctx):
    inputs = ctx.attr.target[AppClientOptimizeDepsInfo].client_transitive_optimize_deps
    output = ctx.actions.declare_file("{}.mjs".format(ctx.label.name))

    extra_optimize_deps = [
        # Dependency used on the client from `//app`. We don't include node modules
        # from `//app` in `app_client_optimize_deps_data` since `//app` has both
        # client and server code mixed together.
        "pretty-ms",

        # Imports explicitly included by the Remix Vite plugin. Make sure these are
        # all included.
        # https://github.com/remix-run/remix/blob/6f83cf3d11436f6306a5d5f2468ce2cc4fe8e3ea/packages/remix-dev/vite/plugin.ts#L1086-L1101
        "react",
        "react/jsx-runtime",
        "react/jsx-dev-runtime",
        "react-dom/client",
        "@remix-run/react",
    ]

    ctx.actions.run_shell(
        inputs = inputs,
        outputs = [output],
        command = """\
echo "# @generated by //app:write_app_client_optimize_deps" > '{output}'
echo >> '{output}'
echo "APP_CLIENT_OPTIMIZE_DEPS = [" >> '{output}'
echo $'{extra_optimize_deps}' | cat - {inputs} | {vanilla_extract_filter} | sort | uniq | sed -e 's/.*/    "&",/g' >> '{output}'
echo "]" >> '{output}'
""".format(
            extra_optimize_deps = "\\n".join(extra_optimize_deps),
            inputs = " ".join(["'{}'".format(input.path) for input in inputs.to_list()]),
            output = output.path,
            # We exclude `@vanilla-extract/` packages since that's a build dependency. But
            # `@vanilla-extract/dynamic` is a runtime package the client imports.
            vanilla_extract_filter = """grep -v "@vanilla-extract/" | cat - <(echo "@vanilla-extract/dynamic")""",
        ),
        # This action is pretty simple. We trust it to be hermetic. So to improve
        # performance don't use a sandbox.
        execution_requirements = {"no-sandbox": "1"},
    )

    return DefaultInfo(files = depset([output]))

app_client_optimize_deps = rule(
    _app_client_optimize_deps_impl,
    attrs = {
        "target": attr.label(providers = [JsInfo], aspects = [app_client_optimize_deps_aspect]),
    },
)
