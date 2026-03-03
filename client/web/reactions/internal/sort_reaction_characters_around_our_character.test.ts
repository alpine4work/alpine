import {sortReactionCharactersAroundOurCharacter} from "~/client/web/reactions/internal/sort_reaction_characters_around_our_character.js";
import {orderedReactionCharacters} from "~/client/web/reactions/ordered_reaction_characters_and_emotions.js";
import {ReactionCharacter} from "~/shared/reactions/reaction.js";

test("places our character first in the result", () => {
    const ourCharacter: ReactionCharacter = {type: "Cat", variant: "Pink"};
    const result = sortReactionCharactersAroundOurCharacter(ourCharacter);

    expect(result[0]).toEqual(ourCharacter);
});

test("places characters of the same type after our character but before different types", () => {
    const ourCharacter: ReactionCharacter = {type: "Cat", variant: "Pink"};
    const result = sortReactionCharactersAroundOurCharacter(ourCharacter);

    // Find where our character is (should be first)
    const ourCharacterIndex = 0;

    // Find the other Cat variants
    const yellowCatIndex = result.findIndex(c => c.type === "Cat" && c.variant === "Yellow");
    const greyCatIndex = result.findIndex(c => c.type === "Cat" && c.variant === "Grey");

    // Find the first non-Cat character
    const firstNonCatIndex = result.findIndex(c => c.type !== "Cat");

    // Other Cat variants should come after our character but before other types
    expect(yellowCatIndex).toBeGreaterThan(ourCharacterIndex);
    expect(greyCatIndex).toBeGreaterThan(ourCharacterIndex);
    expect(yellowCatIndex).toBeLessThan(firstNonCatIndex);
    expect(greyCatIndex).toBeLessThan(firstNonCatIndex);
});

test("places characters after our character first, then characters before our character", () => {
    const ourCharacter: ReactionCharacter = {type: "Cat", variant: "Pink"};
    const result = sortReactionCharactersAroundOurCharacter(ourCharacter);

    // Find our character's index in the original order
    const ourCharacterIndex = orderedReactionCharacters.findIndex(
        c => c.type === ourCharacter.type && c.variant === ourCharacter.variant,
    );

    // Get characters that come after our character in original order (excluding same
    // type)
    const charactersAfterUs = orderedReactionCharacters
        .slice(ourCharacterIndex + 1)
        .filter(c => c.type !== ourCharacter.type);

    // Get characters that come before our character in original order (excluding same
    // type)
    const charactersBeforeUs = orderedReactionCharacters
        .slice(0, ourCharacterIndex)
        .filter(c => c.type !== ourCharacter.type);

    // Get the non-Cat characters from result
    const resultNonCats = result.filter(c => c.type !== "Cat");

    // Should be: characters after us, then characters before us
    const expectedOrder = [...charactersAfterUs, ...charactersBeforeUs];
    expect(resultNonCats).toEqual(expectedOrder);
});

test("preserves the original order for same-type characters that come before our character", () => {
    const ourCharacter: ReactionCharacter = {type: "Cat", variant: "Grey"}; // Last Cat in original order
    const result = sortReactionCharactersAroundOurCharacter(ourCharacter);

    // Should be: Grey, Yellow, Pink, then other types
    const catCharacters = result.filter(c => c.type === "Cat");
    expect(catCharacters).toEqual([
        {type: "Cat", variant: "Grey"},
        {type: "Cat", variant: "Yellow"},
        {type: "Cat", variant: "Pink"},
    ]);
});

test("works when our character is the first in the original order", () => {
    const ourCharacter: ReactionCharacter = {type: "Yeti", variant: "Blue"}; // First in original order
    const result = sortReactionCharactersAroundOurCharacter(ourCharacter);

    // Should start with Blue Yeti, then other Yetis, then rest of original order
    expect(result[0]).toEqual({type: "Yeti", variant: "Blue"});
    expect(result[1]).toEqual({type: "Yeti", variant: "Brown"});
    expect(result[2]).toEqual({type: "Yeti", variant: "Olive"});

    // Then should continue with Cats
    expect(result[3]).toEqual({type: "Cat", variant: "Yellow"});
});

test("works when our character is the last in the original order", () => {
    const ourCharacter: ReactionCharacter = {type: "Frog", variant: "Yellow"};
    const result = sortReactionCharactersAroundOurCharacter(ourCharacter);

    expect(result[0]).toEqual({type: "Frog", variant: "Yellow"});
    expect(result[1]).toEqual({type: "Frog", variant: "Green"});
    expect(result[2]).toEqual({type: "Frog", variant: "Cyan"});

    // Then should continue with Yetis from the beginning
    expect(result[3]).toEqual({type: "Yeti", variant: "Blue"});
});

test("returns all characters exactly once", () => {
    const ourCharacter: ReactionCharacter = {type: "Cat", variant: "Pink"};
    const result = sortReactionCharactersAroundOurCharacter(ourCharacter);

    expect(result.length).toBe(orderedReactionCharacters.length);

    // Check that every original character appears exactly once
    for (const character of orderedReactionCharacters) {
        const count = result.filter(
            c => c.type === character.type && c.variant === character.variant,
        ).length;
        expect(count).toBe(1);
    }
});

test("throws assertion error for non-existent character", () => {
    // This would be a character that doesn't exist in orderedReactionCharacters
    const nonExistentCharacter = {type: "Cat", variant: "Purple"} as any;

    expect(() => {
        sortReactionCharactersAroundOurCharacter(nonExistentCharacter);
    }).toThrow();
});

test("handles middle character correctly", () => {
    const ourCharacter: ReactionCharacter = {type: "Cat", variant: "Yellow"}; // Middle of Cat variants
    const result = sortReactionCharactersAroundOurCharacter(ourCharacter);

    // Should be: Yellow Cat, Pink Cat, Grey Cat, then Yetis, then Trees, then Blue
    // Tree, Green Tree
    const expectedOrder = [
        {type: "Cat", variant: "Yellow"},
        {type: "Cat", variant: "Pink"},
        {type: "Cat", variant: "Grey"},
        {type: "Tree", variant: "Green"},
        {type: "Tree", variant: "Blue"},
        {type: "Tree", variant: "Pink"},
        {type: "Pigeon", variant: "Plain"},
        {type: "Pigeon", variant: "Brown"},
        {type: "Pigeon", variant: "Grey"},
        {type: "Tulip", variant: "Yellow"},
        {type: "Tulip", variant: "Pink"},
        {type: "Tulip", variant: "Violet"},
        {type: "Frog", variant: "Green"},
        {type: "Frog", variant: "Cyan"},
        {type: "Frog", variant: "Yellow"},
        {type: "Yeti", variant: "Blue"},
        {type: "Yeti", variant: "Brown"},
        {type: "Yeti", variant: "Olive"},
    ];

    expect(result).toEqual(expectedOrder);
});
