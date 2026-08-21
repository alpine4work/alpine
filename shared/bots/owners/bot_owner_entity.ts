import {InvalidArgumentError} from "~/shared/error/error.open_source.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";
import {assertId, isId} from "~/shared/id/id.open_source.js";
import {AccountId, SpaceId} from "~/shared/id/types/id_types.open_source.js";
import {Schema, SchemaDeserializationError, SchemaType} from "~/shared/schema/schema.js";

/**
 * A reference to the entity that owns and manages a bot. Encoded as a
 * `{entityType}:{entityId}` string so it can be used directly as a DynamoDB index
 * partition key (see `BotsByOwnerIndex`).
 *
 * - `Account:${AccountId}` is a "personal" bot managed by an individual account.
 *   These are typically used to connect an account to an external service.
 * - `Space:${SpaceId}` is a bot managed by a space.
 *
 * `System` represents a global/system bot that Alpine manages and that isn't owned
 * by any one entity.
 */
export type BotOwnerEntityId = `Account:${AccountId}` | `Space:${SpaceId}` | "System";

export const BotOwnerEntitySchema = Schema.union({
    Account: Schema.object({
        type: Schema.value("Account"),
        accountId: Schema.id<AccountId>(),
    }),
    Space: Schema.object({
        type: Schema.value("Space"),
        spaceId: Schema.id<SpaceId>(),
    }),
    System: Schema.object({
        type: Schema.value("System"),
    }),
});

/**
 * The parsed form of a `BotOwnerEntityId`. Prefer this discriminated union when
 * reasoning about a bot's owner in application code (e.g. authorization checks).
 */
export type BotOwnerEntity = SchemaType<typeof BotOwnerEntitySchema>;

export const BotOwnerEntityIdSchema = Schema.string.transform<BotOwnerEntityId>({
    serialize: ownerEntity => ownerEntity,
    deserialize: ownerEntity => {
        if (!isBotOwnerEntityKey(ownerEntity))
            throw new SchemaDeserializationError("Expected bot owner entity");

        return ownerEntity;
    },
});

export type BotOwnerType = BotOwnerEntity["type"];

/**
 * Builds the `BotOwnerEntityId` for a personal bot owned by an account.
 */
export function botOwnerEntityIdForAccount(accountId: AccountId): BotOwnerEntityId {
    return `Account:${accountId}`;
}

/**
 * Builds the `BotOwnerEntityId` for a bot owned by a space.
 */
export function botOwnerEntityIdForSpace(spaceId: SpaceId): BotOwnerEntityId {
    return `Space:${spaceId}`;
}

/**
 * Builds the `BotOwnerEntityId` for a global/system bot.
 */
export function botOwnerEntityIdForSystem(): BotOwnerEntityId {
    return "System";
}

/**
 * Parses a `BotOwnerEntityId` string into its discriminated union form.
 */
export function parseBotOwnerEntityId(ownerEntity: BotOwnerEntityId): BotOwnerEntity {
    const [type, entityId = ""] = ownerEntity.split(":");

    switch (type) {
        case "Account":
            return {type, accountId: assertId<AccountId>(entityId)};
        case "Space":
            return {type, spaceId: assertId<SpaceId>(entityId)};
        case "System":
            return {type};
        default:
            throw new InvalidArgumentError("Invalid bot owner entity type");
    }
}

/**
 * Is the provided string a valid `BotOwnerEntityKey`?
 */
export function isBotOwnerEntityKey(value: string): value is BotOwnerEntityId {
    const [type, entityId = "", extra] = value.split(":");
    if (extra !== undefined) return false;
    switch (type) {
        case "Account":
        case "Space":
            return isId(entityId);
        case "System":
            return value === "System";
        default:
            return false;
    }
}

/**
 * Converts a `BotOwnerEntity` into a `BotOwnerEntityId`.
 */
export function intoBotOwnerEntityId(ownerEntity: BotOwnerEntity): BotOwnerEntityId {
    switch (ownerEntity.type) {
        case "Account":
            return botOwnerEntityIdForAccount(ownerEntity.accountId);
        case "Space":
            return botOwnerEntityIdForSpace(ownerEntity.spaceId);
        case "System":
            return botOwnerEntityIdForSystem();
        default:
            throw exhaustive(ownerEntity);
    }
}
