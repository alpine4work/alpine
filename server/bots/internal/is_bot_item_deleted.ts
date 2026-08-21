/**
 * Was the bot soft-deleted? A deleted bot keeps its attributes and avatar but can
 * no longer be used, messaged, or authenticated with.
 *
 * Reads the flat `isDeleted` attribute rather than `deleted` because that's the
 * one the `BotsByOwner` index filters on, so this stays true to what the index
 * does. The two are always written together (see `bots_table.ts`).
 */
export function isBotItemDeleted(item: {readonly isDeleted: Date | null}): boolean {
    return item.isDeleted !== null;
}
