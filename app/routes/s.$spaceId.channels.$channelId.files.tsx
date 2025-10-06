import {useSearchParams} from "react-router-dom";
import {deserializeChannelIdForLoader} from "~/app/helpers/deserialize_id_for_loader.js";
import {ChannelFilesView} from "~/client/forum/channel_files_view.js";
import {getInitialChannelFilesViewFileLoadCount} from "~/client/forum/get_initial_channel_files_view_load_count.js";
import {newChannelNamePlaceholder} from "~/client/forum/new_channel_name_placeholder.js";
import {createMetaFunction} from "~/client/remix/create_meta_function.js";
import {useLoaderDataWithSchema} from "~/client/remix/use_loader_data_with_schema.js";
import {metaTitleSeparator} from "~/client/remix/use_update_meta_title.js";
import {getChannelAndMetadata} from "~/server/forum/data/get_channel_and_metadata.js";
import {jsonWithSchema} from "~/server/remix/json_with_schema.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {createDynamoGeneralRealtimeQuerySchema} from "~/shared/dynamo/dynamo_general_realtime_types.js";
import {ChannelModel, ChannelOrMetadataModelSchema} from "~/shared/forum/channel_model.js";
import {Schema} from "~/shared/schema/schema.js";
import {TracerEventData} from "~/shared/tracer/types/tracer_event_data.js";

const LoaderSchema = Schema.object({
    channelResult: createDynamoGeneralRealtimeQuerySchema(ChannelOrMetadataModelSchema),
});

export async function loader({params, context: unauthenticatedContext}: LoaderArgs) {
    const context = await unauthenticatedContext.actor.authenticate();

    const channelId = deserializeChannelIdForLoader(params.channelId ?? null);

    const channelResult = await getChannelAndMetadata(context, {
        channelId,
        postFilesLimit: getInitialChannelFilesViewFileLoadCount(context.loader.getClientInfo()),
    });

    const propagateEventData: TracerEventData = {
        context: {channelId},
    };

    return jsonWithSchema(LoaderSchema, {channelResult}, {propagateEventData});
}

export const meta = createMetaFunction(LoaderSchema, ({data: {channelResult}}) => {
    return [
        {
            title: `Files ${metaTitleSeparator} ${
                channelResult.items[0]?.model instanceof ChannelModel
                    ? channelResult.items[0].model.name
                    : newChannelNamePlaceholder
            }`,
        },
    ];
});

export default function ChannelFilesRoute() {
    const {channelResult} = useLoaderDataWithSchema(LoaderSchema);

    const [searchParams] = useSearchParams();
    const isFromChannelView = searchParams.get("from") === "channel";

    return (
        <ChannelFilesView
            initialChannelResult={channelResult}
            isFromChannelView={isFromChannelView}
        />
    );
}
