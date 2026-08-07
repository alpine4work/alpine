import {useState} from "react";
import {Box} from "~/client/web/design/box.js";
import {ReactionPartyBase} from "~/client/web/reactions/reaction_party.js";
import {colorSchemeVars} from "~/client/web/styles/styles.js";
import {generateId} from "~/shared/id/id.open_source.js";
import {AccountId} from "~/shared/id/types/id_types.open_source.js";
import {Reaction, ReactionCharacter} from "~/shared/reactions/reaction.js";
import {ReactionSet} from "~/shared/reactions/reaction_set.js";

export function AuthenticationReactionPartyPreview({
    emailAddress,
    reactionCharacter,
}: {
    emailAddress: string;
    reactionCharacter: ReactionCharacter;
}) {
    const [[exampleAccount1Id, exampleAccount2Id, exampleAccount3Id]] = useState(() => {
        return [generateId<AccountId>(), generateId<AccountId>(), generateId<AccountId>()] as const;
    });

    return (
        <Box position="relative">
            <ReactionPartyBase
                randomSeed={`SignUp:${emailAddress}`}
                reactions={
                    new ReactionSet(
                        new Map<AccountId, Reaction | "GenericLike">([
                            [
                                exampleAccount1Id,
                                {
                                    character:
                                        reactionCharacter.type === "Cat" ||
                                        (reactionCharacter.type === "Frog" &&
                                            reactionCharacter.variant === "Yellow") ||
                                        (reactionCharacter.type === "Tulip" &&
                                            reactionCharacter.variant === "Yellow")
                                            ? {type: "Yeti", variant: "Blue"}
                                            : {type: "Cat", variant: "Yellow"},
                                    emotion: "Yes",
                                },
                            ],
                            [
                                exampleAccount2Id,
                                {
                                    character:
                                        reactionCharacter.type === "Tree" ||
                                        (reactionCharacter.type === "Frog" &&
                                            reactionCharacter.variant === "Green")
                                            ? {type: "Yeti", variant: "Blue"}
                                            : {type: "Tree", variant: "Green"},
                                    emotion: "Celebrate",
                                },
                            ],
                            [exampleAccount3Id, {character: reactionCharacter, emotion: "Happy"}],
                        ]),
                    )
                }
            />
            <svg
                xmlns="http://www.w3.org/2000/svg"
                width={28}
                height={20}
                fill="none"
                style={{
                    position: "absolute",
                    top: "0.875rem",
                    left: "3.625rem",
                }}
            >
                <path
                    fill={colorSchemeVars["grey-10"]}
                    d="m19.259 13.786-.337-.67.337.67ZM.502 11.314a.75.75 0 0 0-.458.957l2.245 6.365a.75.75 0 0 0 1.414-.499L1.708 12.48l5.658-1.996a.75.75 0 0 0-.499-1.414L.502 11.314ZM26.39.199l-.723.2c.42 1.524.215 3.97-.874 6.438-1.08 2.447-2.992 4.83-5.872 6.279l.337.67.336.67c3.244-1.631 5.376-4.305 6.571-7.013 1.185-2.687 1.484-5.495.948-7.443l-.723.2Zm-7.132 13.587-.337-.67c-5.953 2.992-12.42.826-17.847-1.771l-.324.676-.324.676c5.447 2.607 12.522 5.1 19.168 1.759l-.336-.67Z"
                />
            </svg>
            <Box
                position="absolute"
                color="grey-40"
                fontSize="50"
                style={{
                    position: "absolute",
                    top: "-0.125rem",
                    left: "4.625rem",
                }}
            >
                You
            </Box>
        </Box>
    );
}
