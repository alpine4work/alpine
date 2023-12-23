import {Schema, SchemaType} from "~/shared/schema/schema.js";

/**
 * We fire one of these interactions once every 5 minutes while the user is
 * viewing an entity. So the longer a user views, the more affinity they have
 * towards the entity they're viewing.
 *
 * However, if the user leaves their computer open forever we cap viewing time
 * to 1 hour (12 interactions) so they don't get infinite affinity points. If
 * the component mounts/unmounts or the page is hidden/made visible then we
 * reset that 1 hour cap. So if the user is actively navigating around the
 * product, then functionally there's no limit to view interactions.
 *
 * We expect all view interactions to be recorded by
 * `useSearchEntityViewingAffinityInteraction()`. Which implements sending
 * affinity points every 5 minutes.
 *
 * This interaction also keeps a record of `lastViewTime` so we can tell the
 * user when the last time they viewed a certain entity was.
 */
const SearchEntityAffinityViewInteractionSchema = Schema.object({
    type: Schema.value("View"),
});

/**
 * A low intent update is one you may make pretty frequently without thinking
 * too hard. Perhaps you're making updates continuously. For example, typing in
 * a document or adding tasks to a collection. Since these updates happen
 * frequently and don't require much thought, they don't contribute much to an
 * entity's affinity score. However, if you make A LOT of low intent updates
 * then they will end up meaningfully contributing to an entity's affinity
 * score.
 *
 * If the user doesn't think about their updates as distinct updates
 * (e.g. keystrokes in a document) then we'll need to throttle how often we add
 * this interaction.
 *
 * The conversion rate is 5 low intent updates equals 1 medium intent update.
 *
 * Examples:
 *
 * - Typing in a document
 * - Adding tasks to a collection
 */
const SearchEntityAffinityLowIntentUpdateInteractionSchema = Schema.object({
    type: Schema.value("LowIntentUpdate"),
});

/**
 * A medium intent update is when the user consciously makes an update to some
 * entity. The user is expressing interest in this entity but isn't expressing
 * a strong sense of ownership.
 *
 * The conversion rate is 3 medium intent updates equals 1 high intent update.
 *
 * Examples:
 *
 * - Send a chat message
 * - Creating a post in a channel
 * - Commenting on a post
 */
const SearchEntityAffinityMediumIntentUpdateInteractionSchema = Schema.object({
    type: Schema.value("MediumIntentUpdate"),
});

/**
 * A high intent update is when the user consciously makes an update to some
 * entity and is explicitly expressing strong interest in the entity. For
 * example, creating the entity.
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
 * Counter-example: Creating a task currently doesn't add affinity points. We
 * want creating a task to be as easy as writing a new line in a document.
 * Since it's so frequent we don't want to "spam" tasks in the affinitive
 * entity list. It could drown out other relevant content. Instead we only
 * start adding affinity points as the user opens and updates a task.
 */
const SearchEntityAffinityHighIntentUpdateInteractionSchema = Schema.object({
    type: Schema.value("HighIntentUpdate"),
});

export type SearchEntityAffinityInteraction = SchemaType<
    typeof SearchEntityAffinityInteractionSchema
>;

export const SearchEntityAffinityInteractionSchema = Schema.union({
    View: SearchEntityAffinityViewInteractionSchema,
    LowIntentUpdate: SearchEntityAffinityLowIntentUpdateInteractionSchema,
    MediumIntentUpdate: SearchEntityAffinityMediumIntentUpdateInteractionSchema,
    HighIntentUpdate: SearchEntityAffinityHighIntentUpdateInteractionSchema,
});
