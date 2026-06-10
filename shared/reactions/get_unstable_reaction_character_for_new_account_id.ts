import {StableRandom} from "~/shared/helpers/number/stable_random.js";
import {AccountId} from "~/shared/id/types/id_types.js";
import {
    ReactionCharacter,
    allReactionCharacterTypes,
    allReactionCharacterVariantsByType,
} from "~/shared/reactions/reaction.js";

/**
 * Picks a random reaction character for a new account. Deterministically uses the
 * new `AccountId` so test expectations use the right reaction character. And so
 * this function is idempotent. Though function will not be stable across deploys
 * (which is why we call it "unstable"). If we add more reaction characters then
 * this function will return different results between deploys.
 *
 * Use `getLegacyFallbackReactionCharacterForId()` if you need a stable reaction
 * character across deploys. `getLegacyFallbackReactionCharacterForId()` It uses
 * the same set of reaction characters forever to make sure the picked reaction
 * stays the same across deploys.
 */
export function getUnstableReactionCharacterForNewAccountId(
    accountId: AccountId,
): ReactionCharacter {
    const stableRandom = new StableRandom("UnstableReactionCharacterForNewAccount");

    const typeIndex = stableRandom.randomInteger(accountId, 0, 0, allReactionCharacterTypes.length);
    const type = allReactionCharacterTypes[typeIndex]!;

    const variantIndex = stableRandom.randomInteger(
        accountId,
        1,
        0,
        allReactionCharacterVariantsByType[type].length,
    );
    const variant = allReactionCharacterVariantsByType[type][variantIndex]!;

    return {type, variant} as ReactionCharacter;
}
