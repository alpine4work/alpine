import {layoutReactionParty} from "~/client/web/reactions/internal/layout_reaction_party.js";
import {generateId} from "~/shared/id/id.js";
import {AccountId} from "~/shared/id/types/id_types.js";
import {
    Reaction,
    ReactionCharacter,
    ReactionCharacterType,
    ReactionEmotion,
} from "~/shared/reactions/reaction.js";
import {ReactionSet} from "~/shared/reactions/reaction_set.js";

const a1 = generateId<AccountId>();
const a2 = generateId<AccountId>();
const a3 = generateId<AccountId>();
const a4 = generateId<AccountId>();
const a5 = generateId<AccountId>();
const a6 = generateId<AccountId>();
const a7 = generateId<AccountId>();
const a8 = generateId<AccountId>();
const a9 = generateId<AccountId>();
const a10 = generateId<AccountId>();
const a11 = generateId<AccountId>();

const reaction = (
    character: ReactionCharacter | ReactionCharacterType,
    emotion: ReactionEmotion = "Laugh",
): Reaction => ({
    character:
        character === "Tree"
            ? {type: "Tree", variant: "Green"}
            : character === "Cat"
            ? {type: "Cat", variant: "Yellow"}
            : character === "Yeti"
            ? {type: "Yeti", variant: "Blue"}
            : character,
    emotion,
});

test("can layout zero reactions", () => {
    expect(layoutReactionParty(21, new ReactionSet(new Map()))).toEqual({
        reactionEntries: expect.any(Array),
        firstRowReactionEntries: [],
        secondRowReactionEntries: [],
    });
});

test("can layout one reaction", () => {
    expect(
        layoutReactionParty(21, new ReactionSet(new Map([[a1, reaction("Tree", "Happy")]]))),
    ).toEqual({
        reactionEntries: expect.any(Array),
        firstRowReactionEntries: [{accountId: a1, reaction: reaction("Tree", "Happy")}],
        secondRowReactionEntries: [],
    });
});

test("can layout three reactions", () => {
    expect(
        layoutReactionParty(
            21,
            new ReactionSet(
                new Map([
                    [a1, reaction("Tree")],
                    [a2, reaction("Cat")],
                    [a3, reaction("Yeti")],
                ]),
            ),
        ),
    ).toEqual({
        reactionEntries: expect.any(Array),
        firstRowReactionEntries: [
            {accountId: a1, reaction: reaction("Tree")},
            {accountId: a3, reaction: reaction("Yeti")},
        ],
        secondRowReactionEntries: [{accountId: a2, reaction: reaction("Cat")}],
    });
});

test("spaces out reactions of the same character", () => {
    expect(
        layoutReactionParty(
            21,
            new ReactionSet(
                new Map([
                    [a1, reaction("Tree", "Happy")],
                    [a4, reaction("Tree", "Celebrate")],
                    [a2, reaction("Cat")],
                    [a3, reaction("Yeti")],
                ]),
            ),
        ),
    ).toEqual({
        reactionEntries: expect.any(Array),
        firstRowReactionEntries: [
            {accountId: a1, reaction: reaction("Tree", "Happy")},
            {accountId: a3, reaction: reaction("Yeti")},
        ],
        secondRowReactionEntries: [
            {accountId: a2, reaction: reaction("Cat")},
            {accountId: a4, reaction: reaction("Tree", "Celebrate")},
        ],
    });
});

test("doesn’t space out reactions of the same character of the same type but different variants", () => {
    expect(
        layoutReactionParty(
            21,
            new ReactionSet(
                new Map([
                    [a1, reaction({type: "Tree", variant: "Green"}, "Happy")],
                    [a4, reaction({type: "Tree", variant: "Blue"}, "Celebrate")],
                    [a2, reaction("Cat")],
                    [a3, reaction("Yeti")],
                ]),
            ),
        ),
    ).toEqual({
        reactionEntries: expect.any(Array),
        firstRowReactionEntries: [
            {accountId: a1, reaction: reaction({type: "Tree", variant: "Green"}, "Happy")},
            {accountId: a2, reaction: reaction("Cat")},
        ],
        secondRowReactionEntries: [
            {
                accountId: a4,
                reaction: reaction({type: "Tree", variant: "Blue"}, "Celebrate"),
            },
            {accountId: a3, reaction: reaction("Yeti")},
        ],
    });
});

test("spaces out reactions of the same character among many reactions", () => {
    expect(
        layoutReactionParty(
            21,
            new ReactionSet(
                new Map([
                    [a1, reaction("Tree", "Happy")],
                    [a9, reaction("Yeti")],
                    [a4, reaction("Cat")],
                    [a3, reaction("Cat")],
                    [a11, reaction({type: "Yeti", variant: "Brown"})],
                    [a10, reaction({type: "Yeti", variant: "Brown"})],
                    [a8, reaction("Yeti")],
                    [a6, reaction({type: "Cat", variant: "Pink"})],
                    [a2, reaction("Tree", "Celebrate")],
                    [a5, reaction({type: "Cat", variant: "Pink"})],
                    [a7, reaction({type: "Cat", variant: "Grey"})],
                ]),
            ),
        ),
    ).toEqual({
        reactionEntries: expect.any(Array),
        firstRowReactionEntries: [
            {accountId: a1, reaction: reaction("Tree", "Happy")},
            {accountId: a4, reaction: reaction("Cat")},
            {accountId: a8, reaction: reaction("Yeti")},
            {accountId: a10, reaction: reaction({type: "Yeti", variant: "Brown"})},
            {accountId: a2, reaction: reaction("Tree", "Celebrate")},
            {accountId: a5, reaction: reaction({type: "Cat", variant: "Pink"})},
        ],
        secondRowReactionEntries: [
            {accountId: a9, reaction: reaction("Yeti")},
            {accountId: a11, reaction: reaction({type: "Yeti", variant: "Brown"})},
            {accountId: a3, reaction: reaction("Cat")},
            {accountId: a6, reaction: reaction({type: "Cat", variant: "Pink"})},
            {accountId: a7, reaction: reaction({type: "Cat", variant: "Grey"})},
        ],
    });
});

test("if we can’t find enough space between characters then we add to the first position where there isn’t an adjacent character of the same type", () => {
    expect(
        layoutReactionParty(
            21,
            new ReactionSet(
                new Map([
                    [a1, reaction("Tree", "Happy")],
                    [a2, reaction("Tree", "Celebrate")],
                    [a3, reaction("Cat")],
                    [a4, reaction("Yeti")],
                    [a5, reaction("Tree", "Lolsob")],
                    [a6, reaction("Cat")],
                    [a7, reaction("Yeti")],
                    [a8, reaction("Tree", "DeadInside")],
                ]),
            ),
        ),
    ).toEqual({
        reactionEntries: expect.any(Array),
        firstRowReactionEntries: [
            {accountId: a1, reaction: reaction("Tree", "Happy")},
            {accountId: a4, reaction: reaction("Yeti")},
            {accountId: a6, reaction: reaction("Cat")},
            {accountId: a7, reaction: reaction("Yeti")},
        ],
        secondRowReactionEntries: [
            {accountId: a3, reaction: reaction("Cat")},
            {accountId: a2, reaction: reaction("Tree", "Celebrate")},
            {accountId: a8, reaction: reaction("Tree", "DeadInside")},
            {accountId: a5, reaction: reaction("Tree", "Lolsob")},
        ],
    });
});

test("if we can’t find enough space between characters then and there isn’t a position without adjacent characters then we add them to the end", () => {
    expect(
        layoutReactionParty(
            21,
            new ReactionSet(
                new Map([
                    [a1, reaction("Tree", "Happy")],
                    [a2, reaction("Tree", "Celebrate")],
                    [a3, reaction("Cat")],
                    [a4, reaction("Tree", "Lolsob")],
                    [a5, reaction("Yeti")],
                    [a6, reaction("Tree", "DeadInside")],
                ]),
            ),
        ),
    ).toEqual({
        reactionEntries: expect.any(Array),
        firstRowReactionEntries: [
            {accountId: a1, reaction: reaction("Tree", "Happy")},
            {accountId: a4, reaction: reaction("Tree", "Lolsob")},
            {accountId: a2, reaction: reaction("Tree", "Celebrate")},
        ],
        secondRowReactionEntries: [
            {accountId: a3, reaction: reaction("Cat")},
            {accountId: a5, reaction: reaction("Yeti")},
            {accountId: a6, reaction: reaction("Tree", "DeadInside")},
        ],
    });
});
