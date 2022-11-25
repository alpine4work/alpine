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
    "ably@1.2.30": ["//admin/patches:ably@1.2.30.patch"],
    "browserify-zlib@0.1.4": ["//admin/patches:browserify-zlib@0.1.4.patch"],
    "esbuild-jest@0.5.0": ["//admin/patches:esbuild-jest@0.5.0.patch"],
    "media-query-parser@2.0.2": ["//admin/patches:media-query-parser@2.0.2.patch"],
    "outdent@0.8.0": ["//admin/patches:outdent@0.8.0.patch"],
    "prosemirror-view@1.27.2": ["//admin/patches:prosemirror-view@1.27.2.patch"],
}
