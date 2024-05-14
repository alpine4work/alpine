"""
Configuration files for our native iOS app generated at build time.
"""

load("@bazel_skylib//rules:common_settings.bzl", "BuildSettingInfo")

def _build_config_impl(ctx):
    base_url_setting = ctx.attr._base_url[BuildSettingInfo].value
    base_url = ctx.attr.default_base_url if base_url_setting == "default" else base_url_setting

    domain = base_url
    domain = domain.removeprefix("http://")
    domain = domain.removeprefix("https://")
    domain = domain.removesuffix(":3000")

    base_url_output = ctx.actions.declare_file("Sources/webBaseUrl.swift")
    info_plist_output = ctx.actions.declare_file("Resources/Info.plist")

    ctx.actions.run_shell(
        outputs = [base_url_output],
        command = 'echo "let webBaseUrl = \\"$1\\"" > $2',
        arguments = [base_url, base_url_output.path],
    )

    ctx.actions.expand_template(
        template = ctx.file._template_info_plist,
        output = info_plist_output,
        substitutions = {
            "{{APP_BOUND_DOMAIN}}": domain,
        },
    )

    return [
        DefaultInfo(files = depset([base_url_output, info_plist_output])),
        OutputGroupInfo(
            swift_files = depset([base_url_output]),
            plist_files = depset([info_plist_output]),
        ),
    ]

build_config = rule(
    _build_config_impl,
    attrs = {
        "default_base_url": attr.string(),
        "_base_url": attr.label(default = "//native/mobile/ios:base_url"),
        "_template_info_plist": attr.label(
            default = "//native/mobile/ios:Resources/TemplateInfo.plist",
            allow_single_file = [".plist"],
        ),
    },
)
