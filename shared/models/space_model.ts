import {ChannelId, SpaceId} from "~/shared/id/types/id_types";
import {Model} from "~/shared/models/model";
import {Schema} from "~/shared/schema/schema";

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
