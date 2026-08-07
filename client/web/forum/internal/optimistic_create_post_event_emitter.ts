import {RynamoEvent} from "~/shared/dynamo/rynamo_types.js";
import {PostModel} from "~/shared/forum/post_model.js";
import {EventEmitter} from "~/shared/helpers/control/event_emitter.open_source.js";
import {ChannelId} from "~/shared/id/types/id_types.open_source.js";

export const optimisticCreatePostEventEmitter = new EventEmitter<{
    channelId: ChannelId;
    events: ReadonlyArray<RynamoEvent<PostModel>>;
}>();
