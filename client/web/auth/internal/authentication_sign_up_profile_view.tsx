import {useEffect, useId, useRef, useState} from "react";
import {
    AuthenticationSignUpProfileState,
    AuthenticationState,
} from "~/client/web/auth/authentication_state.js";
import {AuthenticationReactionPartyPreview} from "~/client/web/auth/internal/authentication_reaction_party_preview.js";
import {Form} from "~/client/web/auth/internal/form.js";
import {ReactionCharacterGridSelector} from "~/client/web/auth/internal/reaction_character_grid_selector.js";
import {useAppContext} from "~/client/web/context/app_context.js";
import {Box} from "~/client/web/design/box.js";
import {Button} from "~/client/web/design/button.js";
import {Spacer} from "~/client/web/design/spacer.js";
import {TextInput} from "~/client/web/design/text_input.js";
import {LogoWordmark} from "~/client/web/icons/brand/logo_wordmark.js";
import {usePlatform} from "~/client/web/remix/platform_context.js";
import {sprinkles} from "~/client/web/styles/styles.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";
import {getUnstableReactionCharacterForNewAccountId} from "~/shared/reactions/get_unstable_reaction_character_for_new_account_id.js";
import {saveAccountSignUpProfile} from "~/shared/rpc/accounts_rpc_definitions.js";
import {maxLabelStringLength} from "~/shared/schema/helpers/label_string_schema.js";
import {TracerEventData} from "~/shared/tracer/types/tracer_event_data.js";

export function AuthenticationSignUpProfileView({
    state,
    onStateChange,
}: {
    state: AuthenticationSignUpProfileState;
    onStateChange: (state: AuthenticationState, options: {spanData: TracerEventData}) => void;
}) {
    const context = useAppContext();
    const platform = usePlatform();

    const nameInputRef = useRef<HTMLInputElement>(null);

    // Immediately focus the name input when the component mounts. Only on desktop when
    // focusing the input won't open a giant keyboard.
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

    const [{reactionCharacter, hasChangedReactionCharacter}, setReactionCharacterState] = useState(
        () => ({
            reactionCharacter: getUnstableReactionCharacterForNewAccountId(state.accountId),
            hasChangedReactionCharacter: false,
        }),
    );

    return (
        <Form
            submitErrorTitle="Couldn&#x2019;t sign up"
            onSubmit={async () => {
                await saveAccountSignUpProfile(context, {
                    accountId: state.accountId,
                    name: trimmedName,
                    reactionCharacter,
                });

                onStateChange(
                    {
                        type: "SignUpInvite",
                        accountId: state.accountId,
                        emailAddress: state.emailAddress,
                        reactionCharacter,
                    },
                    {spanData: {auth: {signUp: {hasChangedReactionCharacter}}}},
                );
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
            <Spacer space="2.5" />
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
                maxLength={maxLabelStringLength}
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
            <AuthenticationReactionPartyPreview
                emailAddress={state.emailAddress}
                reactionCharacter={reactionCharacter}
            />
            <Spacer space="3" />
            <ReactionCharacterGridSelector
                aria-labelledby={reactionCharacterLabelId}
                character={reactionCharacter}
                onCharacterChange={reactionCharacter => {
                    setReactionCharacterState({
                        reactionCharacter,
                        hasChangedReactionCharacter: true,
                    });
                }}
            />
            <Spacer space="14" />
        </Form>
    );
}
