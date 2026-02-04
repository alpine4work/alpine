import {useEffect, useId, useRef, useState} from "react";
import {
    AuthenticationSignUpProfileState,
    AuthenticationState,
} from "~/client/web/auth/authentication_state.js";
import {Form} from "~/client/web/auth/internal/form.js";
import {ReactionCharacterGridSelector} from "~/client/web/auth/internal/reaction_character_grid_selector.js";
import {useAppContext} from "~/client/web/context/app_context.js";
import {Box} from "~/client/web/design/box.js";
import {Button} from "~/client/web/design/button.js";
import {Spacer} from "~/client/web/design/spacer.js";
import {TextInput} from "~/client/web/design/text_input.js";
import {LogoWordmark} from "~/client/web/icons/brand/logo_wordmark.js";
import {ReactionPartyBase} from "~/client/web/reactions/reaction_party.js";
import {usePlatform} from "~/client/web/remix/platform_context.js";
import {colorSchemeVars, sprinkles} from "~/client/web/styles/styles.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {generateId} from "~/shared/id/id.js";
import {AccountId} from "~/shared/id/types/id_types.js";
import {getUnstableReactionCharacterForNewAccountId} from "~/shared/reactions/get_unstable_reaction_character_for_new_account_id.js";
import {Reaction, ReactionCharacter} from "~/shared/reactions/reaction.js";
import {ReactionSet} from "~/shared/reactions/reaction_set.js";
import {saveAccountSignUpProfile} from "~/shared/rpc/accounts_rpc_definitions.js";

export function AuthenticationSignUpProfileView({
    state,
    onStateChange,
}: {
    state: AuthenticationSignUpProfileState;
    onStateChange: (state: AuthenticationState) => void;
}) {
    const context = useAppContext();
    const platform = usePlatform();

    const nameInputRef = useRef<HTMLInputElement>(null);

    // Immediately focus the name input when the component mounts. Only on
    // desktop when focusing the input won't open a giant keyboard.
    const hasInitiallyMountedRef = useRef(false);
    useEffect(() => {
        if (hasInitiallyMountedRef.current) return;
        hasInitiallyMountedRef.current = true;

        if (platform === "desktop") {
            const nameInputElement = assertExists(nameInputRef.current);
            nameInputElement.focus();
        }
    }, [platform]);

    const [name, setName] = useState("");
    const trimmedName = name.trim();

    const reactionCharacterLabelId = useId();

    const [reactionCharacter, setReactionCharacter] = useState<ReactionCharacter>(() =>
        getUnstableReactionCharacterForNewAccountId(state.accountId),
    );

    const [[exampleAccount1Id, exampleAccount2Id, exampleAccount3Id]] = useState(() => {
        return [generateId<AccountId>(), generateId<AccountId>(), generateId<AccountId>()] as const;
    });

    return (
        <Form
            submitErrorTitle="Couldn&#x2019;t sign up"
            onSubmit={async () => {
                await saveAccountSignUpProfile(context, {
                    accountId: state.accountId,
                    name: trimmedName,
                    reactionCharacter,
                });

                onStateChange({
                    type: "SignUpOneTimePassword",
                    accountId: state.accountId,
                    emailAddress: state.emailAddress,
                });
            }}
            button={
                <Button
                    variant="accent"
                    shouldSubmitForm={true}
                    fullWidth={true}
                    fontSize="100"
                    height="9"
                    isDisabled={trimmedName.length === 0}
                >
                    Sign up
                </Button>
            }
        >
            <LogoWordmark size="32" />
            <Spacer space="1" />
            <Box fontSize="100" color="grey-60" userSelect="text">
                Nice to meet you, what&#x2019;s your name?
            </Box>
            <Spacer space="8" />
            <TextInput
                ref={nameInputRef}
                formName="name"
                label="Full name"
                autoComplete="name"
                placeholder="Anthony Mose"
                fontSize="100"
                value={name}
                onChange={setName}
            />
            <Spacer space="7" />
            <label
                id={reactionCharacterLabelId}
                className={sprinkles({
                    // `display: block; width: fit-content` is important here! As `inline-block`
                    // there's some weird additional vertical space underneath the label.
                    display: "block",
                    width: "fit-content",
                    maxWidth: "full",
                    fontSize: "75",
                    fontStyle: "semi-bold",
                    paddingBottom: "1.5",
                })}
            >
                Character
            </label>
            <Box color="grey-50" userSelect="text">
                Optional. Your character represents you in reactions, for example:
            </Box>
            <Spacer space="4" />
            <Box position="relative">
                <ReactionPartyBase
                    randomSeed={`SignUp:${state.emailAddress}`}
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
                                [
                                    exampleAccount3Id,
                                    {character: reactionCharacter, emotion: "Happy"},
                                ],
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
            <Spacer space="3" />
            <ReactionCharacterGridSelector
                aria-labelledby={reactionCharacterLabelId}
                character={reactionCharacter}
                onCharacterChange={setReactionCharacter}
            />
            <Spacer space="14" />
        </Form>
    );
}
