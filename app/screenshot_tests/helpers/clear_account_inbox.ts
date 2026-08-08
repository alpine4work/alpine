import {ScreenshotTestRunner} from "~/app/screenshot_tests/helpers/run_screenshot_test.js";
import {createTestPushContextModules} from "~/server/dynamo/test_helpers/create_test_push_context_modules.js";
import {archiveInboxEntry} from "~/server/notifications/data/archive_inbox_entry.js";
import {getInboxEntries} from "~/server/notifications/data/get_inbox_entries.js";
import {TestSpaceSession} from "~/server/spaces/test_helpers/test_space_session.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.open_source.js";

/**
 * Archives every entry in the account's inbox so it sits at "inbox zero".
 *
 * The nav-rail notification badge renders `inbox.loudNotificationCount`, which is
 * delivered to the client over a realtime subscription and climbs as events
 * arrive. A screenshot can therefore capture the count mid-settle, which makes any
 * screenshot that includes the space chrome flake on the badge. Clearing the inbox
 * to a stable, badge-free state before capturing sidesteps the realtime timing
 * entirely.
 *
 * Call this after all content (and its notification jobs) has settled and right
 * before the screenshot phase, then drain jobs once more so the archive writes
 * propagate.
 */
export async function clearAccountInbox(
    session: TestSpaceSession,
    runner: ScreenshotTestRunner,
): Promise<void> {
    const spaceId = session.space.id;
    const readContext = session.action();
    const archiveContext = session.action().clone(createTestPushContextModules());

    await runner.drainBackgroundWork();

    // Re-query from the start on each pass: archiving moves entries out of the "New"
    // filter, so the next query returns the remaining entries until none are left.
    // Screenshot inboxes are small, so this converges in a pass or two.
    for (;;) {
        const {items} = await getInboxEntries(readContext, {
            spaceId,
            filter: "New",
            limit: 100,
            afterCursor: null,
        });

        if (items.length === 0) return;

        await runAllPromises(
            items.map(item =>
                archiveInboxEntry(archiveContext, {spaceId, key: item.model.getKey()}),
            ),
        );
    }
}
