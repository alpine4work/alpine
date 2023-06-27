"""
An aspect that collects all the TypeScript source files for a given rule. Use
this when you want to use a different compiler than the one which comes with
`ts_project()`.
"""

load("@aspect_bazel_lib//lib:copy_to_bin.bzl", "copy_file_to_bin_action")
load("@aspect_rules_js//js:providers.bzl", "JsInfo")
load("@aspect_rules_ts//ts:defs.bzl", "TsConfigInfo")

TsSourcesInfo = provider(
    doc = "Get TypeScript source files instead of JavaScript source files",
    fields = ["sources", "transitive_sources", "runfiles"],
)

def _ts_sources_aspect_impl(target, ctx):
    if not (JsInfo in target):
        return []

    sources_files = []
    sources_depsets = []
    transitive_sources = []
    data = []
    runfiles = []

    if hasattr(ctx.rule.attr, "srcs"):
        is_js_library_for_ts_project = False

        for src in ctx.rule.attr.srcs:
            if TsConfigInfo in src:
                is_js_library_for_ts_project = True

            if TsSourcesInfo in src:
                transitive_sources.append(src[TsSourcesInfo].transitive_sources)
                runfiles.append(src[TsSourcesInfo].runfiles)

        # Add sources for all `ts_project()` rules. Not for `js_library()` rules.
        if TsConfigInfo in target:
            for src in ctx.rule.files.srcs:
                if (src.extension == "js" or
                    src.extension == "jsx" or
                    src.extension == "ts" or
                    src.extension == "tsx" or
                    src.extension == "mjs" or
                    src.extension == "cjs" or
                    src.extension == "json" or
                    src.extension == "css"):
                    sources_files.append(copy_file_to_bin_action(ctx, src))

        elif not is_js_library_for_ts_project:
            # Don't add sources for `js_library()`s that contain the transpiled output of
            # `ts_project()`s. We want the TypeScript source files instead.
            #
            # Transpiled outputs are usually in CommonJS.
            sources_depsets.append(target[JsInfo].sources)

    if hasattr(ctx.rule.attr, "data"):
        for data_target in ctx.rule.attr.data:
            data.append(data_target[DefaultInfo].files)
            runfiles.append(data_target[DefaultInfo].default_runfiles)

    if hasattr(ctx.rule.attr, "deps"):
        for dep_target in ctx.rule.attr.deps:
            if TsSourcesInfo in dep_target:
                transitive_sources.append(dep_target[TsSourcesInfo].transitive_sources)

            if JsInfo in dep_target:
                transitive_sources.append(dep_target[JsInfo].transitive_npm_linked_package_files)

            # If this is a `js_library()` then we only want runfiles from its `data`
            # attribute. Not runfiles from its sources or `node_modules`.
            if JsInfo in dep_target:
                runfiles.append(dep_target[TsSourcesInfo].runfiles)
            else:
                runfiles.append(dep_target[DefaultInfo].default_runfiles)

    sources = depset(sources_files, transitive = sources_depsets)

    return [TsSourcesInfo(
        sources = sources,
        transitive_sources = depset(transitive = [sources] + transitive_sources),
        runfiles = ctx.runfiles(transitive_files = depset(transitive = data)).merge_all(runfiles),
    )]

ts_sources_aspect = aspect(
    implementation = _ts_sources_aspect_impl,
    attr_aspects = ["deps", "srcs"],
)
