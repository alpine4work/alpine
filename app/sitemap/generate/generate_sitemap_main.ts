import fs from "fs/promises";

import {alpineSitemapGeneratedComment, buildSitemap} from "~/app/sitemap/build_sitemap.js";

/** Generate the committed production sitemap artifact. */
async function main(): Promise<void> {
    const sitemap = await buildSitemap();

    await fs.writeFile(
        "app/sitemap/generate/sitemap.xml",
        // The XML declaration must remain the document's first line.
        sitemap.replace("\n", `\n${alpineSitemapGeneratedComment}\n\n`),
    );
}

main().catch(error => {
    // eslint-disable-next-line no-console
    console.error(error);
    process.exitCode = 1;
});
