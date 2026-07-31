import {LinkDescriptor, json, redirect} from "@remix-run/server-runtime";
import {Params} from "react-router";
import {redirectToAuthenticatedHome} from "~/app/helpers/redirect_to_authenticated_home.js";
import {AuthenticationView} from "~/client/web/auth/authentication_view.js";
import {GoogleAdsConversionTrackingScript} from "~/client/web/auth/google_ads_conversion_tracking_script.js";
import {colorSchemeVars} from "~/client/web/styles/styles.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {isId} from "~/shared/id/id.js";
import {SpaceId} from "~/shared/id/types/id_types.js";

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

// Never revalidate! Navigation and data loading is handled entirely on the client.
export function shouldRevalidate() {
    return false;
}

export async function loader({request, context}: LoaderArgs) {
    const url = new URL(request.url);
    const toSearchParam = url.searchParams.get("to");
    const inviteSearchParam = url.searchParams.get("invite");

    // Can not access this page while signed in.
    if (await context.actor.isAuthenticatedSession()) {
        if (toSearchParam?.startsWith("/")) return redirect(toSearchParam);

        if (inviteSearchParam && isId<SpaceId>(inviteSearchParam)) {
            return redirect(`/invite/${inviteSearchParam}`);
        }

        return await redirectToAuthenticatedHome(context);
    }

    return json({});
}

export default function AuthVariantRoute() {
    return (
        <>
            <GoogleAdsConversionTrackingScript />
            <AuthenticationView />
        </>
    );
}
