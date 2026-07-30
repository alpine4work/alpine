import {ShouldRevalidateFunction, useSearchParams} from "@remix-run/react";
import {useEffect, useState} from "react";
import {ChannelCreator} from "~/client/web/forum/channel_creator.js";
import {metaTitlePostfix} from "~/client/web/remix/use_update_meta_title.js";
import {emptyMessageContentWithReferences} from "~/shared/content/message_content_schema.js";

export function meta() {
    return [{title: `New channel${metaTitlePostfix}`}];
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

    // The client removes the `create` and `focus` search params. Don't revalidate when
    // the client does this.
    if (currentUrl.toString() === nextUrl.toString()) {
        return false;
    }

    return defaultShouldRevalidate;
};

export default function NewChannelRoute() {
    const [searchParams, setSearchParams] = useSearchParams();

    const [initiallyFocus] = useState(() => {
        const focusString = searchParams.get("focus");
        if (!focusString) return null;
        return focusString === "name"
            ? ("Name" as const)
            : focusString === "description"
              ? ("Description" as const)
              : null;
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
        <ChannelCreator
            title="New channel"
            initiallyFocus={initiallyFocus}
            initialName=""
            initialDescription={emptyMessageContentWithReferences}
        />
    );
}
