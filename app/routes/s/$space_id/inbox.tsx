import {useIsInitialAppRender} from "~/client/helpers/lifecycle/use_is_initial_app_render";
import {inboxEntryViewMinHeight} from "~/client/inbox/inbox_entry_view";
import {InboxView} from "~/client/inbox/inbox_view";
import {createMetaFunction} from "~/client/remix/create_meta_function";
import {useLoaderDataWithSchema} from "~/client/remix/use_loader_data_with_schema";
import {getInitialVirtualizedScrollViewRenderedItemCount} from "~/client/virtualized/virtualized_scroll_view";
import {getInboxEntries} from "~/server/dynamo/notifications_table";
import {jsonWithSchema} from "~/server/remix/json_with_schema";
import {LoaderArgs} from "~/server/remix/loader_context";
import {createDynamoGeneralRealtimeIndexQuerySchema} from "~/shared/dynamo/dynamo_general_realtime_types";
import {SpaceId} from "~/shared/id/types/id_types";
import {InboxEntryModelSchema} from "~/shared/models/inbox_model";
import {Schema} from "~/shared/schema/schema";

const LoaderSchema = Schema.object({
    inboxEntriesResult: createDynamoGeneralRealtimeIndexQuerySchema(InboxEntryModelSchema),
});

export const meta = createMetaFunction(LoaderSchema, ({}) => ({
    title: "Inbox",
}));

export async function loader({params, context}: LoaderArgs) {
    const spaceId = Schema.id<SpaceId>().deserialize(params.space_id ?? null);

    const inboxEntriesResult = await getInboxEntries(await context.actor.authenticate(), {
        spaceId,
        limit: getInitialVirtualizedScrollViewRenderedItemCount(
            context.loader.clientInfo,
            inboxEntryViewMinHeight,
        ),
        afterCursor: null,
    });

    return jsonWithSchema(LoaderSchema, {inboxEntriesResult});
}

export default function InboxRoute() {
    const {inboxEntriesResult} = useLoaderDataWithSchema(LoaderSchema);

    return <InboxView initialEntriesResult={inboxEntriesResult} />;
}
