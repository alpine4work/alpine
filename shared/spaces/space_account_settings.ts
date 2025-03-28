import {Schema, SchemaType} from "~/shared/schema/schema.js";

/**
 * Private settings associated with a space account.
 */
// NOTE(calebmer): This is less thought out than it sounds. Right now, I'm
// imagining if we add a user settings screen then the options there will make
// it into this object. But there's currently no specific plan for a user
// settings screen.
export type SpaceAccountSettings = SchemaType<typeof SpaceAccountSettingsSchema>;

/**
 * The maximum number of favorite shortcuts to show in `<SearchModal>`.
 */
export const searchShortcutFavoriteEntityMaxCount = 5;

/**
 * The default number of favorite shortcuts to show in `<SearchModal>`.
 */
export const searchShortcutFavoriteEntityDefaultCount = 3;

export const SpaceAccountSettingsSchema = Schema.object({
    /**
     * The number of shortcuts to show in `<SearchModal>`.
     */
    searchShortcutFavoriteEntityCount: Schema.integer
        .min(0)
        .max(searchShortcutFavoriteEntityMaxCount)
        .default(searchShortcutFavoriteEntityDefaultCount),
});
