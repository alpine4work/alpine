import type {
    DatabaseServerChangedPages,
    DatabaseServerReadPages,
} from "~/server/databases/database_server.js";
import type {
    DatabasePageDiffs,
    DatabaseTablePageDiffs,
} from "~/shared/databases/database_protocol_schemas.js";
import {type PageDiff, diffPage} from "~/shared/databases/page_diff.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import type {DatabaseTableId} from "~/shared/id/types/id_types.js";

/**
 * Build the realtime `PagesChanged` diffs for a mutation from the server's
 * changed-pages report: one diff per touched page, carrying the page's
 * pre-mutation version (`previousVersion`, so clients can verify their base before
 * applying) and the post-mutation version taken from `readPages`. Empty when the
 * action wrote nothing.
 *
 * Every path that mutates the canonical database — the realtime `executeAction`
 * procedure and the durable object's HTTP `/action` route — must broadcast the
 * diffs built here, or connected clients keep serving the pre-mutation state.
 */
export function buildDatabasePageDiffs(
    changedPages: DatabaseServerChangedPages,
    readPages: DatabaseServerReadPages,
    version: number,
): DatabasePageDiffs {
    const pageDiffs = new Map<DatabaseTableId, DatabaseTablePageDiffs>();
    for (const [tableId, {pages, fileSizeInPages}] of changedPages) {
        // `getBufferedWrites` only emits a table entry when it has at least one buffered
        // page, so a changed-pages entry always carries pages.
        assert(pages.size > 0, `changedPages entry for ${tableId} has no pages`);
        const tableReadPages = assertExists(readPages.get(tableId));
        const diffs = new Map<number, {previousVersion: number; version: number; diff: PageDiff}>();
        for (const [pageIndex, {before, after, beforeVersion}] of pages) {
            diffs.set(pageIndex, {
                previousVersion: beforeVersion,
                version: assertExists(tableReadPages.get(pageIndex)).version,
                diff: diffPage(before, after),
            });
        }
        pageDiffs.set(tableId, {version, diffs, fileSizeInPages});
    }
    return pageDiffs;
}
