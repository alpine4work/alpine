import {decodeIdInto, encodeId, idByteLength} from "~/shared/id/id.js";
import {AccountId} from "~/shared/id/types/id_types.js";
import {Reaction, getReactionInMap} from "~/shared/reactions/reaction.js";
import {reactionById, reactionIds} from "~/shared/reactions/reaction_id.js";
import {createSchemaLazyTransformClass} from "~/shared/schema/helpers/create_schema_lazy_transform_class.js";
import {Schema, SchemaDeserializationError} from "~/shared/schema/schema.js";

export type ReactionSet = InstanceType<typeof ReactionSet>;

/**
 * A set of reactions made against some entity. We store all the reactions for
 * an entity directly in the entity! We store the reactions in an efficient
 * binary format of 16-bit integer representing the `ReactionIcon` followed by
 * the `AccountId` in binary.
 *
 * Reaction order is maintained, so reactions are in chronological order. First
 * reaction in the set is the first reaction to be added to the entity.
 *
 * Each entry is 18 bytes (16 for the `AccountId` and 2 for the
 * `ReactionIconId`). So 1000 reactions take up 18kb. So storing all reactions
 * for an entity can start to get costly. Given the number of users in a space
 * will only reach 1000+ for enterprise companies this may not be a problem. If
 * this becomes a problem we could store a sample of reactions in this set
 * (enough to render a reaction party) and the total count of reactions. Then
 * store all other reactions in separate DynamoDB items.
 */
export const ReactionSet = createSchemaLazyTransformClass<
    Uint8Array,
    ReadonlyMap<AccountId, Reaction | "GenericHeart">
>(Schema.bytes, {
    serialize: map => {
        const bytes = new Uint8Array(map.size * (idByteLength + 2));
        const view = new DataView(bytes.buffer);

        let byteOffset = 0;

        for (const [accountId, reactionIcon] of map) {
            // We put the reaction icon ID first so in the future if we need to evolve this
            // format we can put a sentinel u32 in the front of our bytes that doesn't
            // conflict with our reaction icon IDs.
            view.setUint16(
                byteOffset,
                reactionIcon !== "GenericHeart" ? getReactionInMap(reactionIds, reactionIcon) : 0,
                false, // Make sure we always use big-endian format
            );
            byteOffset += 2;

            decodeIdInto(accountId, bytes, byteOffset);
            byteOffset += idByteLength;
        }

        return bytes;
    },
    deserialize: bytes => {
        const map = new Map<AccountId, Reaction | "GenericHeart">();
        const view = new DataView(bytes.buffer);

        let byteOffset = 0;

        while (byteOffset < bytes.byteLength) {
            if (bytes.byteLength - byteOffset < idByteLength + 2) {
                throw new SchemaDeserializationError(
                    "Incorrect number of bytes for reaction set entry",
                );
            }

            const reactionId = view.getUint16(
                byteOffset,
                false, // Make sure we always use big-endian format
            );
            byteOffset += 2;

            const accountId = encodeId<AccountId>(bytes, byteOffset);
            byteOffset += idByteLength;

            let reaction: Reaction | "GenericHeart";

            if (reactionId === 0) {
                reaction = "GenericHeart";
            } else {
                const actualReactionIcon = reactionById.get().get(reactionId);
                if (!actualReactionIcon) {
                    throw new SchemaDeserializationError("Invalid reaction icon ID");
                }
                reaction = actualReactionIcon;
            }

            map.set(accountId, reaction);
        }

        return new Map(map.entries());
    },
});
