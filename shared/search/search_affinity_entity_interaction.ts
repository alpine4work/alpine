import {Schema, SchemaType} from "~/shared/schema/schema.open_source.js";

/**
 * We fire one of these interactions once every 5 minutes while the user is viewing
 * an entity. So the longer a user views, the more affinity they have towards the
 * entity they're viewing.
 *
 * However, if the user leaves their computer open forever we cap viewing time to 1
 * hour (12 interactions) so they don't get infinite affinity points. If the
 * component mounts/unmounts or the page is hidden/made visible then we reset that
 * 1 hour cap. So if the user is actively navigating around the product, then
 * functionally there's no limit to view interactions.
 *
 * We expect all view interactions to be recorded by
 * `useSearchEntityViewingAffinityInteraction()`. Which implements sending affinity
 * points every 5 minutes.
 *
 * This interaction also keeps a record of `lastViewTime` so we can tell the user
 * when the last time they viewed a certain entity was.
 */
const SearchAffinityViewEntityInteractionSchema = Schema.object({
    type: Schema.value("View"),
});

// NOTE(calebmer, 2023-03-19): Experimental interaction with lower intent than
// `LowIntentUpdate`. In practice I've found documents I've authored dominate my
// affinity list. Even a long time after I've opened them. So I want to try
// lowering the points a document update assigns. We'll see how that affects
// affinity lists. This is all more art than science.
//
// Right now the conversion rate is 16 very low intent updates equals 1 medium
// intent update.
//
// Maybe document editing should be low intent for the first 30min or so then very
// low intent afterwards? To count more points for drive by document contributions.
const SearchAffinityVeryLowIntentUpdateEntityInteractionSchema = Schema.object({
    type: Schema.value("VeryLowIntentUpdate"),
});

/**
 * A low intent update is one you may make pretty frequently without thinking too
 * hard. Perhaps you're making updates continuously. For example, typing in a
 * document or adding tasks to a collection. Since these updates happen frequently
 * and don't require much thought, they don't contribute much to an entity's
 * affinity score. However, if you make A LOT of low intent updates then they will
 * end up meaningfully contributing to an entity's affinity score.
 *
 * If the user doesn't think about their updates as distinct updates (e.g.
 * keystrokes in a document) then we'll need to throttle how often we add this
 * interaction.
 *
 * The conversion rate is 5 low intent updates equals 1 medium intent update.
 *
 * Examples:
 *
 * - Typing in a document
 * - Adding tasks to a collection
 */
const SearchAffinityLowIntentUpdateEntityInteractionSchema = Schema.object({
    type: Schema.value("LowIntentUpdate"),
});

/**
 * A medium intent update is when the user consciously makes an update to some
 * entity. The user is expressing interest in this entity but isn't expressing a
 * strong sense of ownership.
 *
 * The conversion rate is 3 medium intent updates equals 1 high intent update.
 *
 * Examples:
 *
 * - Send a chat message
 * - Creating a post in a channel
 * - Commenting on a post
 */
const SearchAffinityMediumIntentUpdateEntityInteractionSchema = Schema.object({
    type: Schema.value("MediumIntentUpdate"),
});

/**
 * A high intent update is when the user consciously makes an update to some entity
 * and is explicitly expressing strong interest in the entity. For example,
 * creating the entity.
 *
 * Account mentions are included since mentions are a way to get a user's
 * attention. So if one user mentions another it's a clear signal the mentioner
 * cares about the mentionee's attention.
 *
 * Examples:
 *
 * - Creating a document
 * - Creating a channel
 * - Marking a task as active
 * - Mentioning an account
 *
 * Counter-example: Creating a task currently doesn't add affinity points. We want
 * creating a task to be as easy as writing a new line in a document. Since it's so
 * frequent we don't want to "spam" tasks in the affinitive entity list. It could
 * drown out other relevant content. Instead we only start adding affinity points
 * as the user opens and updates a task.
 */
const SearchAffinityHighIntentUpdateEntityInteractionSchema = Schema.object({
    type: Schema.value("HighIntentUpdate"),
});

export type SearchAffinityEntityInteraction = SchemaType<
    typeof SearchAffinityEntityInteractionSchema
>;

export const SearchAffinityEntityInteractionSchema = Schema.union({
    View: SearchAffinityViewEntityInteractionSchema,
    VeryLowIntentUpdate: SearchAffinityVeryLowIntentUpdateEntityInteractionSchema,
    LowIntentUpdate: SearchAffinityLowIntentUpdateEntityInteractionSchema,
    MediumIntentUpdate: SearchAffinityMediumIntentUpdateEntityInteractionSchema,
    HighIntentUpdate: SearchAffinityHighIntentUpdateEntityInteractionSchema,
});
