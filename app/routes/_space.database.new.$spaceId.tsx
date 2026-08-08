import {ShouldRevalidateFunction, useSearchParams} from "@remix-run/react";
import {useEffect, useState} from "react";
import {deserializeSpaceIdForLoader} from "~/app/helpers/deserialize_id_for_loader.js";
import {DatabaseCreator} from "~/client/web/databases/database_creator.js";
import {Box} from "~/client/web/design/box.js";
import {metaTitlePostfix} from "~/client/web/remix/use_update_meta_title.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {authorizeSpaceAccess} from "~/server/spaces/authorize_space_access.js";

export function meta() {
    return [{title: `New database${metaTitlePostfix}`}];
}

export async function loader({params, context: unauthenticatedContext}: LoaderArgs) {
    const context = (await unauthenticatedContext.actor.authenticate()).actor.authorizeSession();
    const spaceId = deserializeSpaceIdForLoader(params.spaceId);
    await authorizeSpaceAccess(context, spaceId, "Member");
    return null;
}

export const shouldRevalidate: ShouldRevalidateFunction = ({
    currentUrl: _currentUrl,
    nextUrl: _nextUrl,
    defaultShouldRevalidate,
}) => {
    const currentUrl = new URL(_currentUrl);
    const nextUrl = new URL(_nextUrl);

    currentUrl.searchParams.delete("focus");
    nextUrl.searchParams.delete("focus");

    // The client removes the `focus` search param. Don't revalidate when the client
    // does this.
    if (currentUrl.toString() === nextUrl.toString()) {
        return false;
    }

    return defaultShouldRevalidate;
};

export default function NewDatabaseRoute() {
    const [searchParams, setSearchParams] = useSearchParams();

    const [initiallyFocus] = useState(() => {
        const focusString = searchParams.get("focus");
        if (!focusString) return null;
        return focusString === "name" ? ("Name" as const) : null;
    });

    // Remove the `focus` search param.
    useEffect(() => {
        if (searchParams.has("focus")) {
            const newSearchParams = new URLSearchParams(searchParams);
            newSearchParams.delete("focus");
            setSearchParams(newSearchParams, {replace: true});
        }
    }, [searchParams, setSearchParams]);

    return (
        <Box flexGrow="1" width="full" height="full" overflow="hidden" padding="4">
            <DatabaseCreator initiallyFocus={initiallyFocus} />
        </Box>
    );
}
