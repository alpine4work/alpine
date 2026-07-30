import {AuthSignInOrSignUpOpen} from "~/shared/auth/auth_sign_in_or_sign_up_schema.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {EmailAddress} from "~/shared/helpers/string/email_address.js";
import {AccountId} from "~/shared/id/types/id_types.js";
import {ReactionCharacter} from "~/shared/reactions/reaction.js";

export type AuthenticationState =
    | AuthenticationSignInState
    | AuthenticationSignUpState
    | AuthenticationSignUpProfileState
    | AuthenticationSignUpInviteState
    | AuthenticationSignInOneTimePasswordState
    | AuthenticationSignUpOneTimePasswordState
    | AuthenticationAfterSignUpMobileInterstitialState;

export type AuthenticationSignInState = {
    readonly type: "SignIn";
};

export type AuthenticationSignUpState = {
    readonly type: "SignUp";
};

export type AuthenticationSignUpProfileState = {
    readonly type: "SignUpProfile";
    readonly accountId: AccountId;
    readonly emailAddress: EmailAddress;
};

export type AuthenticationSignUpInviteState = {
    readonly type: "SignUpInvite";
    readonly accountId: AccountId;
    readonly emailAddress: EmailAddress;
    readonly reactionCharacter: ReactionCharacter;
};

export type AuthenticationSignInOneTimePasswordState = {
    readonly type: "SignInOneTimePassword";
    readonly accountId: AccountId;
    readonly emailAddress: EmailAddress;
};

export type AuthenticationSignUpOneTimePasswordState = {
    readonly type: "SignUpOneTimePassword";
    readonly accountId: AccountId;
    readonly emailAddress: EmailAddress;
    readonly inviteEmailAddresses: ReadonlyArray<EmailAddress>;
};

export type AuthenticationAfterSignUpMobileInterstitialState = {
    readonly type: "AfterSignUpMobileInterstitial";
    readonly emailAddress: EmailAddress;
    readonly open: AuthSignInOrSignUpOpen | null;
};

export type AuthenticationVariant = (typeof allAuthenticationVariants)[number];

export const allAuthenticationVariants = ["sign-in", "sign-up"] as const;

export const allAuthenticationVariantsSet: ReadonlySet<string> = new Set(allAuthenticationVariants);

export function isAuthenticationVariant(variant: string): variant is AuthenticationVariant {
    return allAuthenticationVariantsSet.has(variant);
}

export const initialAuthenticationStateForVariant: Record<
    AuthenticationVariant,
    AuthenticationState
> = {
    "sign-in": {type: "SignIn"},
    "sign-up": {type: "SignUp"},
};

export function getAuthenticationStateVariant(state: AuthenticationState): AuthenticationVariant {
    switch (state.type) {
        case "SignIn":
        case "SignInOneTimePassword":
            return "sign-in";
        case "SignUp":
        case "SignUpProfile":
        case "SignUpInvite":
        case "SignUpOneTimePassword":
        case "AfterSignUpMobileInterstitial":
            return "sign-up";
        default:
            throw exhaustive(state);
    }
}
