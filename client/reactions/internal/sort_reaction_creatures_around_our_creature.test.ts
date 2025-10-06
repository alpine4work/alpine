import {orderedReactionCreatures} from "~/client/reactions/internal/ordered_reaction_creatures_and_emotions.js";
import {sortReactionCreaturesAroundOurCreature} from "~/client/reactions/internal/sort_reaction_creatures_around_our_creature.js";
import {ReactionCreature} from "~/shared/reactions/reaction.js";

test("places our creature first in the result", () => {
    const ourCreature: ReactionCreature = {type: "Cat", variant: "Pink"};
    const result = sortReactionCreaturesAroundOurCreature(ourCreature);

    expect(result[0]).toEqual(ourCreature);
});

test("places creatures of the same type after our creature but before different types", () => {
    const ourCreature: ReactionCreature = {type: "Cat", variant: "Pink"};
    const result = sortReactionCreaturesAroundOurCreature(ourCreature);

    // Find where our creature is (should be first)
    const ourCreatureIndex = 0;

    // Find the other Cat variants
    const yellowCatIndex = result.findIndex(c => c.type === "Cat" && c.variant === "Yellow");
    const greyCatIndex = result.findIndex(c => c.type === "Cat" && c.variant === "Grey");

    // Find the first non-Cat creature
    const firstNonCatIndex = result.findIndex(c => c.type !== "Cat");

    // Other Cat variants should come after our creature but before other types
    expect(yellowCatIndex).toBeGreaterThan(ourCreatureIndex);
    expect(greyCatIndex).toBeGreaterThan(ourCreatureIndex);
    expect(yellowCatIndex).toBeLessThan(firstNonCatIndex);
    expect(greyCatIndex).toBeLessThan(firstNonCatIndex);
});

test("places creatures after our creature first, then creatures before our creature", () => {
    const ourCreature: ReactionCreature = {type: "Cat", variant: "Pink"};
    const result = sortReactionCreaturesAroundOurCreature(ourCreature);

    // Find our creature's index in the original order
    const ourCreatureIndex = orderedReactionCreatures.findIndex(
        c => c.type === ourCreature.type && c.variant === ourCreature.variant,
    );

    // Get creatures that come after our creature in original order (excluding same type)
    const creaturesAfterUs = orderedReactionCreatures
        .slice(ourCreatureIndex + 1)
        .filter(c => c.type !== ourCreature.type);

    // Get creatures that come before our creature in original order (excluding same type)
    const creaturesBeforeUs = orderedReactionCreatures
        .slice(0, ourCreatureIndex)
        .filter(c => c.type !== ourCreature.type);

    // Get the non-Cat creatures from result
    const resultNonCats = result.filter(c => c.type !== "Cat");

    // Should be: creatures after us, then creatures before us
    const expectedOrder = [...creaturesAfterUs, ...creaturesBeforeUs];
    expect(resultNonCats).toEqual(expectedOrder);
});

test("preserves the original order for same-type creatures that come before our creature", () => {
    const ourCreature: ReactionCreature = {type: "Cat", variant: "Grey"}; // Last Cat in original order
    const result = sortReactionCreaturesAroundOurCreature(ourCreature);

    // Should be: Grey, Yellow, Pink, then other types
    const catCreatures = result.filter(c => c.type === "Cat");
    expect(catCreatures).toEqual([
        {type: "Cat", variant: "Grey"},
        {type: "Cat", variant: "Yellow"},
        {type: "Cat", variant: "Pink"},
    ]);
});

test("works when our creature is the first in the original order", () => {
    const ourCreature: ReactionCreature = {type: "Yeti", variant: "Blue"}; // First in original order
    const result = sortReactionCreaturesAroundOurCreature(ourCreature);

    // Should start with Blue Yeti, then other Yetis, then rest of original order
    expect(result[0]).toEqual({type: "Yeti", variant: "Blue"});
    expect(result[1]).toEqual({type: "Yeti", variant: "Brown"});
    expect(result[2]).toEqual({type: "Yeti", variant: "Olive"});

    // Then should continue with Cats
    expect(result[3]).toEqual({type: "Cat", variant: "Yellow"});
});

test("works when our creature is the last in the original order", () => {
    const ourCreature: ReactionCreature = {type: "Tree", variant: "Pink"}; // Last in original order
    const result = sortReactionCreaturesAroundOurCreature(ourCreature);

    // Should start with Pink Tree, then other Trees, then rest from beginning
    expect(result[0]).toEqual({type: "Tree", variant: "Pink"});
    expect(result[1]).toEqual({type: "Tree", variant: "Blue"});
    expect(result[2]).toEqual({type: "Tree", variant: "Green"});

    // Then should continue with Yetis from the beginning
    expect(result[3]).toEqual({type: "Yeti", variant: "Blue"});
});

test("returns all creatures exactly once", () => {
    const ourCreature: ReactionCreature = {type: "Cat", variant: "Pink"};
    const result = sortReactionCreaturesAroundOurCreature(ourCreature);

    expect(result.length).toBe(orderedReactionCreatures.length);

    // Check that every original creature appears exactly once
    for (const creature of orderedReactionCreatures) {
        const count = result.filter(
            c => c.type === creature.type && c.variant === creature.variant,
        ).length;
        expect(count).toBe(1);
    }
});

test("throws assertion error for non-existent creature", () => {
    // This would be a creature that doesn't exist in orderedReactionCreatures
    const nonExistentCreature = {type: "Cat", variant: "Purple"} as any;

    expect(() => {
        sortReactionCreaturesAroundOurCreature(nonExistentCreature);
    }).toThrow();
});

test("handles middle creature correctly", () => {
    const ourCreature: ReactionCreature = {type: "Cat", variant: "Yellow"}; // Middle of Cat variants
    const result = sortReactionCreaturesAroundOurCreature(ourCreature);

    // Should be: Yellow Cat, Pink Cat, Grey Cat, then Yetis, then Trees, then Blue Tree, Green Tree
    const expectedOrder = [
        {type: "Cat", variant: "Yellow"},
        {type: "Cat", variant: "Pink"},
        {type: "Cat", variant: "Grey"},
        {type: "Tree", variant: "Blue"},
        {type: "Tree", variant: "Green"},
        {type: "Tree", variant: "Pink"},
        {type: "Yeti", variant: "Blue"},
        {type: "Yeti", variant: "Brown"},
        {type: "Yeti", variant: "Olive"},
    ];

    expect(result).toEqual(expectedOrder);
});
