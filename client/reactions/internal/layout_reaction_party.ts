import {filterMapArray} from "~/shared/helpers/array/filter_map_array.js";
import {AccountId} from "~/shared/id/types/id_types.js";
import {Reaction, ReactionCreature} from "~/shared/reactions/reaction.js";
import {ReactionSet} from "~/shared/reactions/reaction_set.js";

export type ReactionEntry = {
    readonly accountId: AccountId;
    readonly reaction: Reaction;
};

const reactionPartyDesiredCountBetweenSameCreatures = 2;

export function layoutReactionParty(
    maxReactionEntryCount: number,
    reactions: ReactionSet,
): {
    reactionEntries: Array<ReactionEntry>;
    firstRowReactionEntries: Array<ReactionEntry>;
    secondRowReactionEntries: Array<ReactionEntry>;
} {
    const originalReactionEntries = filterMapArray(reactions.get(), ([accountId, reaction]) => {
        if (reaction === "GenericHeart") return;
        return {accountId, reaction};
    });

    const reactionEntries: Array<ReactionEntry> = [];
    const pendingReactionEntries: Array<ReactionEntry> = [];

    const canPushReactionCreature = (creature: ReactionCreature): boolean => {
        for (
            let i = Math.max(
                0,
                reactionEntries.length - reactionPartyDesiredCountBetweenSameCreatures,
            );
            i < reactionEntries.length;
            i++
        ) {
            const otherCreature = reactionEntries[i]!.reaction.creature;

            if (
                otherCreature.type === creature.type &&
                otherCreature.variant === creature.variant
            ) {
                return false;
            }
        }

        return true;
    };

    const tryPushPendingReactionEntries = () => {
        for (let j = 0; j < pendingReactionEntries.length; j++) {
            const pendingReactionEntry = pendingReactionEntries[j]!;

            if (canPushReactionCreature(pendingReactionEntry.reaction.creature)) {
                if (reactionEntries.length >= maxReactionEntryCount) break;
                reactionEntries.push(pendingReactionEntry);

                // Remove the pending reaction and decrement `j` so the loop tries again with
                // the new item at index `j`.
                pendingReactionEntries.splice(j, 1);
                j--;
            }
        }
    };

    for (let i = 0; i < originalReactionEntries.length; i++) {
        tryPushPendingReactionEntries();

        const reactionEntry = originalReactionEntries[i]!;

        if (canPushReactionCreature(reactionEntry.reaction.creature)) {
            if (reactionEntries.length >= maxReactionEntryCount) break;
            reactionEntries.push(reactionEntry);
        } else {
            pendingReactionEntries.push(reactionEntry);
        }
    }

    tryPushPendingReactionEntries();

    // Finally, if there are still pending reactions and we're not at our max entry
    // count, add the pending reactions in the last position where they're not
    // adjacent to the same creature. If that fails then we add them to the end.
    while (reactionEntries.length < maxReactionEntryCount && pendingReactionEntries.length > 0) {
        const pendingReactionEntry = pendingReactionEntries.shift()!;
        const {creature} = pendingReactionEntry.reaction;

        let added = false;

        for (let i = reactionEntries.length - 2; i >= 0; i--) {
            const beforeCreature = reactionEntries[i]!.reaction.creature;
            const afterCreature = reactionEntries[i + 1]!.reaction.creature;

            if (
                (creature.type === beforeCreature.type &&
                    creature.variant === beforeCreature.variant) ||
                (creature.type === afterCreature.type && creature.variant === afterCreature.variant)
            ) {
                continue;
            } else {
                added = true;
                reactionEntries.splice(i + 1, 0, pendingReactionEntry);
                break;
            }
        }

        if (!added) {
            reactionEntries.push(pendingReactionEntry);
        }
    }

    const firstRowReactionEntries: Array<ReactionEntry> = [];
    const secondRowReactionEntries: Array<ReactionEntry> = [];

    for (let i = 0; i < reactionEntries.length; i++) {
        const reactionEntry = reactionEntries[i]!;
        if (i % 2 === 0) {
            firstRowReactionEntries.push(reactionEntry);
        } else {
            secondRowReactionEntries.push(reactionEntry);
        }
    }

    return {reactionEntries, firstRowReactionEntries, secondRowReactionEntries};
}
