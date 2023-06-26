import {ChannelId, SpaceId} from "~/shared/id/types/id_types.js";
import {Model} from "~/shared/schema/model/model.js";
import {Schema} from "~/shared/schema/schema.js";

export class SpaceModel extends Model(
    Schema.object({
        id: Schema.id<SpaceId>(),
        name: Schema.string,

        /**
         * During our alpha phase, you can manually set this property in the database
         * and it will be used for some navigation elements until we have proper
         * implementations.
         */
        alphaAccessDefaultChannelId: Schema.id<ChannelId>().optional(),
    }),
) {}
