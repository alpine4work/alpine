import {ShouldRevalidateFunction, useSearchParams} from "@remix-run/react";
import {useEffect, useState} from "react";
import {RoomChatCreator} from "~/client/web/chat/room_chat_creator.js";
import {metaTitlePostfix} from "~/client/web/remix/use_update_meta_title.js";

export function meta() {
    return [{title: `New chat room${metaTitlePostfix}`}];
}

export const shouldRevalidate: ShouldRevalidateFunction = ({
    currentUrl: immutableCurrentUrl,
    nextUrl: immutableNextUrl,
    defaultShouldRevalidate,
}) => {
    const currentUrl = new URL(immutableCurrentUrl);
    const nextUrl = new URL(immutableNextUrl);

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

    return <RoomChatCreator title="New chat room" initiallyFocus={initiallyFocus} initialName="" />;
}
