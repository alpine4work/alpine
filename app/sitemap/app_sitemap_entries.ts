import type {SitemapEntry} from "~/app/sitemap/build_sitemap.js";
import {allAuthenticationVariants} from "~/client/web/auth/authentication_state.js";

/**
 * Non-documentation paths that Alpine includes in its sitemap. Documentation
 * entries are added dynamically from Markdown and YAML content.
 */
export const appSitemapEntries: Array<SitemapEntry> = [
    {pathname: "/", lastModified: null, imageUrls: []},
    ...allAuthenticationVariants.map(variant => ({
        pathname: `/auth/${variant}`,
        lastModified: null,
        imageUrls: [],
    })),
];
