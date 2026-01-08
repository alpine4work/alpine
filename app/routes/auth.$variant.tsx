import {LinkDescriptor} from "@remix-run/server-runtime";
import {AuthenticationView} from "~/client/web/auth/authentication_view.js";
import {colorSchemeVars} from "~/client/web/styles/styles.js";

// NOCOMMIT: Support `to` search param

// NOCOMMIT: Integration tests
//
// - [ ] Sign up with personal email (e.g. `@gmail.com`) starts in personal space
// - [ ] First sign up with company email (e.g. `@company.com`) starts in company space
// - [ ] Second/third sign up with company email (e.g. `@company.com`) starts in company space
// - [ ] First sign in after invitation to space (lands in invited space)
// - [ ] Sign up after invitation to space (lands in invited space)

// NOCOMMIT: Accept invite while signing in

// NOCOMMIT: On mobile throw up interstitial that says "Alpine is better on
// desktop, send an email reminding me to try Alpine on desktop"

// NOCOMMIT: Email design! Specifically:
//
// - [ ] Sign in / sign up code
// - [ ] Invite email

// NOCOMMIT: Nice design right side

// NOCOMMIT: Get actual company logo

// Never revalidate! Navigation and data loading is handled entirely on
// the client.
export function shouldRevalidate() {
    return false;
}

export function meta({params}: {params: Params}) {
    return [{title: params.variant === "sign-up" ? "Sign up for Alpine" : "Sign in to Alpine"}];
}

export function links(): Array<LinkDescriptor> {
    return [
        // Make sure the overscroll color on iOS Safari matches the background color.
        {
            rel: "stylesheet",
            href: `data:text/css,${encodeURIComponent(
                `body {background-color: ${colorSchemeVars["grey-0"]}}`,
            )}`,
        },
    ];
}

export default AuthenticationView;
