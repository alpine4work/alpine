def _typescript_swc_config_impl(ctx):
    ctx.actions.expand_template(
        template = ctx.file.src,
        output = ctx.outputs.out,
        substitutions = {
            "{{module_type}}": ctx.attr.module_type,
            """"{{react}}": {}""": (
                """"react": {"runtime": "automatic", "development": true, "refresh": true}"""
            ) if ctx.attr.react_development else (
                """"react": {"runtime": "automatic", "development": false}"""
            ),
        },
    )

    return DefaultInfo(files = depset([ctx.outputs.out]))

typescript_swc_config = rule(
    _typescript_swc_config_impl,
    attrs = {
        "src": attr.label(mandatory = True, allow_single_file = True),
        "out": attr.output(mandatory = True),
        "module_type": attr.string(mandatory = True),
        "react_development": attr.bool(mandatory = True),
    },
)
