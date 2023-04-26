import {Box} from "~/client/design/box";
import {useLoaderDataWithSchema} from "~/client/remix/use_loader_data_with_schema";
import {getInboxEntries} from "~/server/dynamo/notifications_table";
import {jsonWithSchema} from "~/server/remix/json_with_schema";
import {LoaderArgs} from "~/server/remix/loader_context";
import {SpaceId} from "~/shared/id/types/id_types";
import {Schema} from "~/shared/schema/schema";

const LoaderSchema = Schema.object({});

export async function loader({params, context}: LoaderArgs) {
    const spaceId = Schema.id<SpaceId>().deserialize(params.space_id ?? null);

    console.log(
        await getInboxEntries(await context.actor.authenticate(), {
            spaceId,
            // NOCOMMIT: Proper limit!
            limit: 100,
        }),
    );

    return jsonWithSchema(LoaderSchema, {});
}

export default function InboxRoute() {
    useLoaderDataWithSchema(LoaderSchema);

    return (
        <Box flexGrow="1" overflow="hidden" display="flex">
            <Box
                flexShrink="0"
                overflow="hidden"
                width="96"
                backgroundColor="grey-0"
                borderRight="grey-10"
            ></Box>
            <Box flexGrow="1" overflow="hidden"></Box>
        </Box>
    );
}
