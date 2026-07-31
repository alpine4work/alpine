import fs from "fs/promises";
import {join} from "path";

import type {SitemapEntry} from "~/app/sitemap/build_sitemap.js";
import {runfilesPath} from "~/server/helpers/node/runfiles_path.js";
import {parseDocumentationSitemapEntries} from "~/shared/docs/documentation_sitemap.js";

const generatedDocumentationSitemapPath = join(
    runfilesPath,
    "cyberworlds/app/docs/codegen/generated/documentation_sitemap.json",
);

/** Load generated documentation and blog entries from Bazel runfiles. */
export async function loadGeneratedDocumentationSitemapEntries(): Promise<Array<SitemapEntry>> {
    return parseDocumentationSitemapEntries(
        JSON.parse(await fs.readFile(generatedDocumentationSitemapPath, "utf8")),
    );
}
