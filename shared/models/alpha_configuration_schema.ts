import {SpaceId} from "~/shared/id/types/id_types";
import {Schema, SchemaType} from "~/shared/schema/schema";

export type AlphaConfiguration = SchemaType<typeof AlphaConfigurationSchema>;

export const AlphaConfigurationSchema = Schema.object({
    /**
     * We automatically add all accounts to this space id when we create them since
     * we don't have a way to create spaces from scratch.
     */
    defaultSpaceId: Schema.id<SpaceId>().optional(),

    /**
     * Redirect all users to this URL on sign in. Most likely will start off as a
     * document URL that serves as an index page.
     */
    authenticatedHomeUrl: Schema.string.matches(/^\/[a-zA-Z0-9_\-/%?=&]*$/).optional(),
});
