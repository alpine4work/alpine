import {SpaceId} from "~/shared/id/types/id_types";
import {Model} from "~/shared/models/model";
import {Schema} from "~/shared/schema/schema";

export class SpaceModel extends Model(
    Schema.object({
        id: Schema.id<SpaceId>(),
        name: Schema.string,
    }),
) {}
