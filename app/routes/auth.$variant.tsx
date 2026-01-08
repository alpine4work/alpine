import {LinkDescriptor, json, redirect} from "@remix-run/server-runtime";
import {redirectToAuthenticatedHome} from "~/app/helpers/redirect_to_authenticated_home.js";
import {AuthenticationView} from "~/client/web/auth/authentication_view.js";
import {colorSchemeVars} from "~/client/web/styles/styles.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";

// NOCOMMIT: Integration tests
//
// - [ ] Sign up with personal email (e.g. `@gmail.com`) starts in personal space
// - [ ] First sign up with company email (e.g. `@company.com`) starts in company space
// - [ ] Second/third sign up with company email (e.g. `@company.com`) starts in company space
// - [ ] First sign in after invitation to space (lands in invited space)
// - [ ] Sign up after invitation to space (lands in invited space)
// - [ ] Sign up after invitation to space we would have auto-joined based on email domain

// NOCOMMIT: Accept invite while signing in

// NOCOMMIT: On mobile throw up interstitial that says "Alpine is better on
// desktop, send an email reminding me to try Alpine on desktop"

// NOCOMMIT: Email design! Specifically:
//
// - [ ] Sign in / sign up code
// - [ ] Invite email

// NOCOMMIT: Nice design right side

// NOCOMMIT: Get actual company logo

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

// Never revalidate! Navigation and data loading is handled entirely on
// the client.
export function shouldRevalidate() {
    return false;
}

export async function loader({request, context}: LoaderArgs) {
    const url = new URL(request.url);
    const toSearchParam = url.searchParams.get("to");

    // Can not access this page while signed in.
    if (await context.actor.isAuthenticatedSession()) {
        if (toSearchParam?.startsWith("/")) return redirect(toSearchParam);
        return redirectToAuthenticatedHome(context);
    }

    return json({});
}

export default AuthenticationView;
