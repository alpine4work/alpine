import {redirect} from "@remix-run/node";
import {ShouldRevalidateFunction} from "@remix-run/router";
import {deserializeSpaceIdForLoader} from "~/app/helpers/deserialize_id_for_loader.js";
import {CreateBotView} from "~/client/web/bots/create_bot_view.js";
import {metaTitlePostfix} from "~/client/web/remix/use_update_meta_title.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {hasCustomBotsFeature} from "~/shared/spaces/has_custom_bots_feature.js";

export function meta() {
    return [{title: `Create a bot${metaTitlePostfix}`}];
}

// Custom bot creation is still being built out, so it's gated to development and
// internal spaces. Redirect back to the bot settings list when the feature is off
// so the route isn't reachable by navigating directly to its URL.
export async function loader({params}: LoaderArgs) {
    const spaceId = deserializeSpaceIdForLoader(params.spaceId);

    if (!hasCustomBotsFeature(spaceId)) {
        return redirect(`/settings/${spaceId}/bots`);
    }

    return null;
}

// We don't need to reload if the URL doesn't change.
export const shouldRevalidate: ShouldRevalidateFunction = ({
    currentUrl: immutableCurrentUrl,
    nextUrl: immutableNextUrl,
}) => {
    const currentUrl = new URL(immutableCurrentUrl);
    const nextUrl = new URL(immutableNextUrl);

    return nextUrl.toString() !== currentUrl.toString();
};

export default function CreateBotRoute() {
    return <CreateBotView />;
}
