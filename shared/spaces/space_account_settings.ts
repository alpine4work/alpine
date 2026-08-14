import {Schema, SchemaType} from "~/shared/schema/schema.js";

/**
 * Private settings associated with a space account.
 */
// NOTE(calebmer): This is less thought out than it sounds. Right now, I'm
// imagining if we add a user settings screen then the options there will make it
// into this object. But there's currently no specific plan for a user settings
// screen.
export type SpaceAccountSettings = SchemaType<typeof SpaceAccountSettingsSchema>;

/**
 * The minimum number of favorite shortcuts to show in `<SearchModal>`. We have a
 * minimum of 1 so that it's always the case that if you have at least one favorite
 * we'll always be able to show favorite shortcuts. And not get into a state where
 * you have favorites but no shortcuts.
 *
 * If you have no favorites then we won't render a favorite section in
 * `<SearchModal>` therefore the shortcut count doesn't matter.
 */
export const searchShortcutFavoriteEntityMinCount = 1;

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
        .min(searchShortcutFavoriteEntityMinCount)
        .max(searchShortcutFavoriteEntityMaxCount)
        .default(searchShortcutFavoriteEntityDefaultCount),
});
