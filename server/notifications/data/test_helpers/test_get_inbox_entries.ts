import {getInboxEntries} from "~/server/notifications/data/get_inbox_entries.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {TestSpaceSession} from "~/server/spaces/test_helpers/test_space_session.js";
import {DynamoIndexCursor} from "~/shared/dynamo/dynamo_opaque_strings.js";
import {InboxEntryStatus} from "~/shared/notifications/inbox_entry_status.js";

export async function testGetInboxEntries(
    session: TestSpaceSession,
    {
        space = session.space,
        filter = "New",
        limit = 100,
        afterCursor = null,
    }: {
        space?: TestSpace;
        filter?: InboxEntryStatus;
        limit?: number;
        afterCursor?: DynamoIndexCursor | null;
    } = {},
) {
    const {items} = await getInboxEntries(session.action(), {
        spaceId: space.id,
        filter,
        limit,
        afterCursor,
    });

    return items.map(({model}) => model);
}
