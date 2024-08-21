"""
An aspect that gets runfiles for a `JsInfo` provider after the provider has
been built with esbuild. Notably we don't need individual source files after
building with esbuild.
"""

load("@aspect_rules_js//js:providers.bzl", "JsInfo")
load("@aspect_rules_js//js/private:js_helpers.bzl", "copy_js_file_to_bin_action")
load("@aspect_rules_js//npm:providers.bzl", "NpmPackageStoreInfo")

EsbuildRunfilesInfo = provider(
    doc = "Runfiles for a \"JsInfo\" provider after its been built with esbuild",
    fields = {
        "runfiles_without_sources": "Runfiles without transpiled JavaScript sources",
        "runfiles_without_sources_and_npm_linked_packages": "Runfiles without transpiled JavaScript sources or npm package files",
    },
)

def _esbuild_runfiles_aspect_impl(target, ctx):
    if not (JsInfo in target):
        return []

    runfiles_without_sources = _gather_runfiles(
        copy_data_files_to_bin = ctx.rule.attr.copy_data_to_bin if hasattr(ctx.rule.attr, "copy_data_to_bin") else False,
        ctx = ctx,
        data = ctx.rule.attr.data if hasattr(ctx.rule.attr, "data") else [],
        data_files = ctx.rule.files.data if hasattr(ctx.rule.files, "data") else [],
        include_sources = False,
        include_declarations = False,
        include_npm_linked_packages = True,
        include_transitive_sources = False,
        no_copy_to_bin = ctx.rule.files.no_copy_to_bin if hasattr(ctx.rule.files, "no_copy_to_bin") else [],
        sources = target[JsInfo].transitive_sources,
        # The call in `js_library()` includes `srcs` but because we want to exclude
        # sources in this runfiles object we remove it from here.
        deps = (ctx.rule.attr.declarations if hasattr(ctx.rule.attr, "declarations") else []) + (ctx.rule.attr.deps if hasattr(ctx.rule.attr, "deps") else []),
        get_runfiles = _get_runfiles_without_sources,
    )

    runfiles_without_sources_and_npm_linked_packages = _gather_runfiles(
        copy_data_files_to_bin = ctx.rule.attr.copy_data_to_bin if hasattr(ctx.rule.attr, "copy_data_to_bin") else False,
        ctx = ctx,
        data = ctx.rule.attr.data if hasattr(ctx.rule.attr, "data") else [],
        data_files = ctx.rule.files.data if hasattr(ctx.rule.files, "data") else [],
        include_sources = False,
        include_declarations = False,
        include_npm_linked_packages = False,
        include_transitive_sources = False,
        no_copy_to_bin = ctx.rule.files.no_copy_to_bin if hasattr(ctx.rule.files, "no_copy_to_bin") else [],
        sources = target[JsInfo].transitive_sources,
        # The call in `js_library()` includes `srcs` but because we want to exclude
        # sources in this runfiles object we remove it from here.
        deps = (ctx.rule.attr.declarations if hasattr(ctx.rule.attr, "declarations") else []) + (ctx.rule.attr.deps if hasattr(ctx.rule.attr, "deps") else []),
        get_runfiles = _get_runfiles_without_sources_and_npm_linked_packages,
    )

    return [EsbuildRunfilesInfo(
        runfiles_without_sources = runfiles_without_sources,
        runfiles_without_sources_and_npm_linked_packages = runfiles_without_sources_and_npm_linked_packages,
    )]

esbuild_runfiles_aspect = aspect(
    _esbuild_runfiles_aspect_impl,
    attr_aspects = ["deps"],
)

def _get_runfiles(target):
    return target[DefaultInfo].default_runfiles

def _get_runfiles_without_sources(target):
    return target[EsbuildRunfilesInfo].runfiles_without_sources if EsbuildRunfilesInfo in target else target[DefaultInfo].default_runfiles

def _get_runfiles_without_sources_and_npm_linked_packages(target):
    return target[EsbuildRunfilesInfo].runfiles_without_sources_and_npm_linked_packages if EsbuildRunfilesInfo in target else target[DefaultInfo].default_runfiles

# Forked from:
# https://github.com/aspect-build/rules_js/blob/d0ff155c73e3c7fee5d72485e00775bca1fde10a/js/private/js_helpers.bzl#L177-L260
#
# We add the following parameters:
#
# - `include_sources`: Set to false to remove sources from runfiles
# - `get_runfiles`: Provide a function to get runfiles from somewhere other
#   than `DefaultInfo`
def _gather_runfiles(
        ctx,
        sources,
        data,
        deps,
        data_files = [],
        copy_data_files_to_bin = False,
        no_copy_to_bin = [],
        include_sources = True,
        include_transitive_sources = True,
        include_declarations = False,
        include_npm_linked_packages = True,
        get_runfiles = _get_runfiles):
    transitive_files_depsets = []

    # Includes sources
    if include_sources:
        if type(sources) == "list":
            sources = depset(sources)

        transitive_files_depsets.append(sources)

    # Gather the default outputs of data targets
    transitive_files_depsets.extend([
        target[DefaultInfo].files
        for target in data
    ])

    # Gather the transitive sources & transitive npm linked packages from the JsInfo &
    # NpmPackageStoreInfo providers of data & deps targets.
    transitive_files_depsets.append(_gather_files_from_js_providers(
        targets = data + deps,
        include_sources = include_sources,
        include_transitive_sources = include_transitive_sources,
        include_declarations = include_declarations,
        include_npm_linked_packages = include_npm_linked_packages,
    ))

    files_runfiles = []
    for d in data_files:
        if copy_data_files_to_bin and d.is_source and d not in no_copy_to_bin:
            files_runfiles.append(copy_js_file_to_bin_action(ctx, d))
        else:
            files_runfiles.append(d)

    if len(files_runfiles) > 0:
        transitive_files_depsets.append(depset(files_runfiles))

    # Merge the above with the transitive runfiles of data & deps.
    return ctx.runfiles(
        files = files_runfiles,
        transitive_files = depset(transitive = transitive_files_depsets),
    ).merge_all([
        get_runfiles(target)
        for target in data + deps
    ])

# Forked from:
# https://github.com/aspect-build/rules_js/blob/d0ff155c73e3c7fee5d72485e00775bca1fde10a/js/private/js_helpers.bzl#L297-L341
#
# We add the following parameter:
#
# - `include_sources`: Set to false to remove sources from runfiles
def _gather_files_from_js_providers(
        targets,
        include_sources,
        include_transitive_sources,
        include_declarations,
        include_npm_linked_packages):
    files_depsets = []
    if include_sources:
        files_depsets.extend([
            target[JsInfo].sources
            for target in targets
            if JsInfo in target and hasattr(target[JsInfo], "sources")
        ])
    if include_transitive_sources:
        files_depsets.extend([
            target[JsInfo].transitive_sources
            for target in targets
            if JsInfo in target and hasattr(target[JsInfo], "transitive_sources")
        ])
    if include_declarations:
        files_depsets.extend([
            target[JsInfo].transitive_declarations
            for target in targets
            if JsInfo in target and hasattr(target[JsInfo], "transitive_declarations")
        ])
    if include_npm_linked_packages:
        files_depsets.extend([
            target[JsInfo].transitive_npm_linked_package_files
            for target in targets
            if JsInfo in target and hasattr(target[JsInfo], "transitive_npm_linked_package_files")
        ])
        files_depsets.extend([
            target[NpmPackageStoreInfo].transitive_files
            for target in targets
            if NpmPackageStoreInfo in target and hasattr(target[NpmPackageStoreInfo], "transitive_files")
        ])
    return depset([], transitive = files_depsets)

def _esbuild_runfiles_without_sources_impl(ctx):
    return [DefaultInfo(files = ctx.attr.target[EsbuildRunfilesInfo].runfiles_without_sources.files)]

esbuild_runfiles_without_sources = rule(
    _esbuild_runfiles_without_sources_impl,
    attrs = {
        "target": attr.label(providers = [JsInfo], aspects = [esbuild_runfiles_aspect]),
    },
)

def _esbuild_runfiles_without_sources_and_npm_linked_packages_impl(ctx):
    return [DefaultInfo(files = ctx.attr.target[EsbuildRunfilesInfo].runfiles_without_sources_and_npm_linked_packages.files)]

esbuild_runfiles_without_sources_and_npm_linked_packages = rule(
    _esbuild_runfiles_without_sources_and_npm_linked_packages_impl,
    attrs = {
        "target": attr.label(providers = [JsInfo], aspects = [esbuild_runfiles_aspect]),
    },
)
