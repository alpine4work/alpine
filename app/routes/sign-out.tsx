import {redirect} from "@remix-run/router";
import {deregisterAccountWebPushSubscription} from "~/server/notifications/data/push/deregister_account_web_push_subscription.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";

export async function loader({context}: LoaderArgs) {
    const authenticatedContext = await context.actor.authenticate();

    if (authenticatedContext.actor.type === "Session") {
        const accountId = authenticatedContext.actor.getAccountId();
        context.process.waitUntil(async () => {
            try {
                await deregisterAccountWebPushSubscription(authenticatedContext, {
                    accountId,
                    browserId: context.loader.getBrowserId(),
                });
            } catch (error) {
                context.tracer.logException(
                    "Error deregistering web push subscription on sign out",
                    error,
                );
                // We don't want to block the sign out process if we fail to deregister the web push
                // subscription on the server. We deregister the subscription on the client separately
                // in our service worker.
            }
        });
    }

    context.loader.sessionCookie.dangerouslySet(null);
    return redirect("/auth/sign-in");
}
