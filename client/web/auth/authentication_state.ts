import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {AccountId} from "~/shared/id/types/id_types.js";

export type AuthenticationState =
    | AuthenticationSignInState
    | AuthenticationSignUpState
    | AuthenticationSignUpProfileState
    | AuthenticationSignInOneTimePasswordState
    | AuthenticationSignUpOneTimePasswordState;

export type AuthenticationSignInState = {
    readonly type: "SignIn";
};

export type AuthenticationSignUpState = {
    readonly type: "SignUp";
};

export type AuthenticationSignUpProfileState = {
    readonly type: "SignUpProfile";
    readonly accountId: AccountId;
    readonly emailAddress: string;
};

export type AuthenticationSignInOneTimePasswordState = {
    readonly type: "SignInOneTimePassword";
    readonly accountId: AccountId;
    readonly emailAddress: string;
};

export type AuthenticationSignUpOneTimePasswordState = {
    readonly type: "SignUpOneTimePassword";
    readonly accountId: AccountId;
    readonly emailAddress: string;
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
        case "SignUpOneTimePassword":
            return "sign-up";
        default:
            throw exhaustive(state);
    }
}
