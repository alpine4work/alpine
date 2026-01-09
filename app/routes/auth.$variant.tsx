import {LinkDescriptor, json, redirect} from "@remix-run/server-runtime";
import {Params} from "react-router";
import {redirectToAuthenticatedHome} from "~/app/helpers/redirect_to_authenticated_home.js";
import {AuthenticationView} from "~/client/web/auth/authentication_view.js";
import {colorSchemeVars} from "~/client/web/styles/styles.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";

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
