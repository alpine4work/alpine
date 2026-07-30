import fs from "fs/promises";
import {join} from "path";

import {alpineSitemapGeneratedComment, buildSitemap} from "~/app/sitemap/build_sitemap.js";
import {runfilesPath} from "~/server/helpers/node/runfiles_path.js";
import {getDocumentationResponseCacheHeaders} from "~/shared/docs/documentation_cache_strategy.js";

const productionSitemapPath = join(runfilesPath, "cyberworlds/app/sitemap/sitemap.xml");

/** Serve Alpine's sitemap from every environment. */
export async function loader() {
    const sitemapWithRepositoryMetadata =
        // In development, regenerate it every time so we know what this will look like
        // once documentation is enabled.
        process.env.NODE_ENV === "development"
            ? await buildSitemap()
            : await fs.readFile(productionSitemapPath, "utf8");

    // The generated marker is useful in the repository but isn't public sitemap data.
    const sitemap = sitemapWithRepositoryMetadata.replace(
        `${alpineSitemapGeneratedComment}\n\n`,
        "",
    );

    return new Response(sitemap, {
        headers: {
            "content-type": "application/xml; charset=utf-8",
            ...getDocumentationResponseCacheHeaders("GeneratedMetadata"),
        },
    });
}
