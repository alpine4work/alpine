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
    fields = ["sources", "transitive_sources"],
)

def _ts_sources_aspect_impl(target, ctx):
    sources = []
    transitive_sources = []

    is_js_library_for_ts_project = False
    if JsInfo in target and hasattr(ctx.rule.attr, "srcs"):
        for src in ctx.rule.attr.srcs:
            if TsConfigInfo in src:
                is_js_library_for_ts_project = True
                break

    if hasattr(ctx.rule.attr, "srcs"):
        for src in ctx.rule.attr.srcs:
            if TsSourcesInfo in src:
                transitive_sources.append(src[TsSourcesInfo].transitive_sources)

        # Don't add sources for `js_library()`s that contain the transpiled output of
        # `ts_project()`s. We want the TypeScript source files instead.
        #
        # Transpiled outputs are usually in CommonJS.
        if not is_js_library_for_ts_project:
            for src in ctx.rule.files.srcs:
                if (src.extension == "js" or
                    src.extension == "jsx" or
                    src.extension == "ts" or
                    src.extension == "tsx" or
                    src.extension == "mjs" or
                    src.extension == "json" or
                    src.extension == "css"):
                    sources.append(copy_file_to_bin_action(ctx, src))

    if hasattr(ctx.rule.attr, "deps"):
        for dep in ctx.rule.attr.deps:
            transitive_sources.append(dep[TsSourcesInfo].transitive_sources)

            if JsInfo in dep:
                transitive_sources.append(dep[JsInfo].transitive_npm_linked_package_files)

    return [TsSourcesInfo(
        sources = depset(sources),
        transitive_sources = depset(sources, transitive = transitive_sources),
    )]

ts_sources_aspect = aspect(
    implementation = _ts_sources_aspect_impl,
    attr_aspects = ["deps", "srcs"],
)
