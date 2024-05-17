import {useEffect, useState} from "react";
import {ShouldRevalidateFunction, useSearchParams} from "react-router-dom";
import {PostCreator} from "~/client/forum/post_creator.js";
import {createMetaFunction} from "~/client/remix/create_meta_function.js";
import {useLoaderDataWithSchema} from "~/client/remix/use_loader_data_with_schema.js";
import {getChannelPreview} from "~/server/forum/data/forum_table.js";
import {jsonWithSchema} from "~/server/remix/json_with_schema.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {InvalidArgumentError} from "~/shared/error/error.js";
import {ChannelPreviewModel} from "~/shared/forum/channel_model.js";
import {isId} from "~/shared/id/id.js";
import {ChannelId} from "~/shared/id/types/id_types.js";
import {Schema} from "~/shared/schema/schema.js";

const LoaderSchema = Schema.object({
    draftId: Schema.id(),
    displayCreatedTime: Schema.date,
    channel: ChannelPreviewModel.schema().nullable(),
});

export const meta = createMetaFunction(LoaderSchema, () => [{title: "New post"}]);

export async function loader({context: unauthenticatedContext, params, request}: LoaderArgs) {
    const context = (await unauthenticatedContext.actor.authenticate()).actor.authorizeSession();

    const {draftId} = params;
    if (!draftId || !isId(draftId)) {
        throw new InvalidArgumentError("Draft path segment must be an ID");
    }

    const url = new URL(request.url);
    const channelId = Schema.id<ChannelId>()
        .nullable()
        .deserialize(url.searchParams.get("channel"));

    const channel = channelId ? await getChannelPreview(context, channelId) : null;

    return jsonWithSchema(LoaderSchema, {
        draftId,
        displayCreatedTime: new Date(),
        channel,
    });
}

// We don't need to reload when certain search params change.
export const shouldRevalidate: ShouldRevalidateFunction = ({
    currentUrl: _currentUrl,
    nextUrl: _nextUrl,
}) => {
    const currentUrl = new URL(_currentUrl);
    const nextUrl = new URL(_nextUrl);

    // Used to initially focus the chat:
    nextUrl.searchParams.delete("focus");
    currentUrl.searchParams.delete("focus");

    return nextUrl.toString() !== currentUrl.toString();
};

export default function PostCreateRoute({withMobileLayout = false}: {withMobileLayout?: boolean}) {
    const [searchParams, setSearchParams] = useSearchParams();
    const {
        draftId,
        displayCreatedTime,
        channel: initialChannel,
    } = useLoaderDataWithSchema(LoaderSchema);

    const [channel, setChannel] = useState(initialChannel);

    const shouldReturnBack = searchParams.get("return") === "back";

    const focusSearchParam = searchParams.get("focus");
    const [initiallyFocus] = useState(
        focusSearchParam === "content"
            ? ("ContentEditor" as const)
            : focusSearchParam === "channel"
            ? ("ChannelSelector" as const)
            : null,
    );

    useEffect(() => {
        if (searchParams.has("focus")) {
            const newSearchParams = new URLSearchParams(searchParams);
            newSearchParams.delete("focus");
            setSearchParams(newSearchParams, {replace: true});
        }
    }, [searchParams, setSearchParams]);

    return (
        <PostCreator
            withMobileLayout={withMobileLayout}
            draftId={draftId}
            displayCreatedTime={displayCreatedTime}
            channel={channel}
            onChannelChange={channel => {
                setChannel(channel);

                const newSearchParams = new URLSearchParams(searchParams);

                if (!channel) {
                    newSearchParams.delete("channel");
                } else {
                    newSearchParams.set("channel", channel.id);
                }

                setSearchParams(newSearchParams, {
                    replace: true,
                    // Don't revalidate when updating search params from here. We can't use the
                    // stable `shouldRevalidate` route function because if the user navigates to
                    // a new URL we want to load new data and re-render the route.
                    unstable_shouldRevalidate: false,
                });
            }}
            shouldReturnBack={shouldReturnBack}
            initiallyFocus={initiallyFocus}
        />
    );
}
