"""
Rule for filtering out the `_fonts/font_hashes.ts` file out of the outputs of
`generate_fonts_main.ts`.
"""

def _filter_font_hashes(ctx):
    return DefaultInfo(files = depset([src for src in ctx.files.srcs if not src.basename == "font_hashes.ts"]))

filter_font_hashes = rule(
    implementation = _filter_font_hashes,
    attrs = {
        "srcs": attr.label_list(allow_files = True, mandatory = True),
    },
)
