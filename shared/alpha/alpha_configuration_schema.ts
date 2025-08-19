import {SpaceId} from "~/shared/id/types/id_types.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";

export type AlphaConfiguration = SchemaType<typeof AlphaConfigurationSchema>;

export const AlphaConfigurationSchema = Schema.object({
    /**
     * The `SpaceId` to send the Apple reviewer to.
     */
    appleReviewerSpaceId: Schema.id<SpaceId>().optional(),
});
