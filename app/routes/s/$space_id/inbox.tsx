import {Box} from "~/client/design/box";
import {InboxEntryView} from "~/client/inbox/inbox_entry_view";
import {useLoaderDataWithSchema} from "~/client/remix/use_loader_data_with_schema";
import {getInboxEntries} from "~/server/dynamo/notifications_table";
import {jsonWithSchema} from "~/server/remix/json_with_schema";
import {LoaderArgs} from "~/server/remix/loader_context";
import {createDynamoGeneralRealtimeIndexQuerySchema} from "~/shared/dynamo/dynamo_general_realtime_types";
import {SpaceId} from "~/shared/id/types/id_types";
import {InboxEntryModelSchema} from "~/shared/models/inbox_model";
import {Schema} from "~/shared/schema/schema";

const LoaderSchema = Schema.object({
    inboxEntriesQuery: createDynamoGeneralRealtimeIndexQuerySchema(InboxEntryModelSchema),
});

export async function loader({params, context}: LoaderArgs) {
    const spaceId = Schema.id<SpaceId>().deserialize(params.space_id ?? null);

    const inboxEntriesQuery = await getInboxEntries(await context.actor.authenticate(), {
        spaceId,
        // NOCOMMIT: Proper limit!
        limit: 100,
    });

    return jsonWithSchema(LoaderSchema, {inboxEntriesQuery});
}

export default function InboxRoute() {
    const {inboxEntriesQuery} = useLoaderDataWithSchema(LoaderSchema);

    return (
        <Box flexGrow="1" overflow="hidden" display="flex">
            <Box
                flexShrink="0"
                overflow="hidden"
                width="96"
                backgroundColor="grey-0"
                borderRight="grey-10"
            >
                {inboxEntriesQuery.items.map(item => (
                    <InboxEntryView key={item.key} entry={item.model} />
                ))}
            </Box>
            <Box flexGrow="1" overflow="hidden"></Box>
        </Box>
    );
}
