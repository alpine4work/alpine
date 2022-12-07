"""
Patches for `node_modules` generated with `pnpm patch`.
"""

NPM_PATCHES = {
    "@miniflare/http-server@2.11.0": ["//admin/patches:@miniflare__http-server@2.11.0.patch"],
    "@remix-run/dev@1.7.5": ["//admin/patches:@remix-run__dev@1.7.5.patch"],
    "@remix-run/react@1.7.5": ["//admin/patches:@remix-run__react@1.7.5.patch"],
    "@remix-run/server-runtime@1.7.5": ["//admin/patches:@remix-run__server-runtime@1.7.5.patch"],
    "@types/react@18.0.15": ["//admin/patches:@types__react@18.0.15.patch"],
    "@vanilla-extract/integration@5.0.1": ["//admin/patches:@vanilla-extract__integration@5.0.1.patch"],
    "@vanilla-extract/sprinkles@1.5.0": ["//admin/patches:@vanilla-extract__sprinkles@1.5.0.patch"],
    "browserify-zlib@0.1.4": ["//admin/patches:browserify-zlib@0.1.4.patch"],
    "clean-css@4.2.4": ["//admin/patches:clean-css@4.2.4.patch"],
    "esbuild-jest@0.5.0": ["//admin/patches:esbuild-jest@0.5.0.patch"],
    "media-query-parser@2.0.2": ["//admin/patches:media-query-parser@2.0.2.patch"],
    "mjml-parser-xml@4.13.0": ["//admin/patches:mjml-parser-xml@4.13.0.patch"],
    "outdent@0.8.0": ["//admin/patches:outdent@0.8.0.patch"],
    "prosemirror-view@1.27.2": ["//admin/patches:prosemirror-view@1.27.2.patch"],
    "uglify-js@3.17.4": ["//admin/patches:uglify-js@3.17.4.patch"],
    "wrangler@2.4.4": ["//admin/patches:wrangler@2.4.4.patch"],
}
