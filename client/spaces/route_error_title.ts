import {useContext} from "react";
import {UNSAFE_DataRouterStateContext as DataRouterStateContext} from "react-router";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";

const errorTitleByRouteId: {
    readonly [key: string]: string | undefined;
} = {
    "routes/s.$spaceId._index": "Couldn’t open home",
    "routes/s.$spaceId.channels.$channelId._index": "Couldn’t open channel",
    "routes/s.$spaceId.chat.$chatId": "Couldn’t open chat",
    "routes/s.$spaceId.chat.new": "Couldn’t create chat",
    "routes/s.$spaceId.chat.with.$accountId": "Couldn’t open chat",
    "routes/s.$spaceId.create._index": "Couldn’t open menu",
    "routes/s.$spaceId.create.more": "Couldn’t open menu",
    "routes/s.$spaceId.documents.$documentId._index": "Couldn’t open document",
    "routes/s.$spaceId.documents.$documentId.comments.$commentThreadId":
        "Couldn’t open comment thread",
    "routes/s.$spaceId.documents.$documentId.view": "Couldn’t open document",
    "routes/s.$spaceId.inbox": "Couldn’t open inbox",
    "routes/s.$spaceId.more._index": "Couldn’t open menu",
    "routes/s.$spaceId.more.switch-space": "Couldn’t open menu",
    "routes/s.$spaceId.notifications.channel-posts.$channelIdAndBucketGeneration":
        "Couldn’t open notification",
    "routes/s.$spaceId.notifications.document-comment-threads.$documentIdAndBucketGeneration":
        "Couldn’t open notification",
    "routes/s.$spaceId.posts.$postId": "Couldn’t open post",
    "routes/s.$spaceId.posts.new.$draftId": "Couldn’t create post",
    "routes/s.$spaceId.search": "Couldn’t open search",
    "routes/s.$spaceId.tasks.$taskId._index": "Couldn’t open task",
    "routes/s.$spaceId.tasks.$taskId.comments": "Couldn’t open task",
    "routes/s.$spaceId.tasks._index": "Couldn’t open tasks",
    "routes/s.$spaceId.tasks.collections.$collectionId": "Couldn’t open tasks",
    "routes/s.$spaceId.tasks.view": "Couldn’t open tasks",
    "routes/switch-space": "Couldn’t open menu",
};

export function getRouteIdsWithDefinedErrorTitleForTest() {
    assert(import.meta.jest);
    return Object.keys(errorTitleByRouteId);
}

/**
 * Get error title to use when the route error boundary catches an error. The
 * title is generally pretty generic like "Couldn’t open document" and the
 * error is expected to provide a more detailed error message.
 *
 * We prefer using short, generic, language like "Couldn’t open tasks" instead
 * of "Couldn’t open task collection" so the user has less to parse when they
 * encounter an error.
 */
export function getRouteErrorTitle(routeId: string | null): string {
    const errorTitle = routeId ? errorTitleByRouteId[routeId.replace(".peek.", ".")] : undefined;
    return errorTitle ?? "Couldn’t open page";
}

/**
 * Get error title to use when the route error boundary catches an error. The
 * title is generally pretty generic like "Couldn’t open document" and the
 * error is expected to provide a more detailed error message.
 *
 * We prefer using short, generic, language like "Couldn’t open tasks" instead
 * of "Couldn’t open task collection" so the user has less to parse when they
 * encounter an error.
 */
export function useRouteErrorTitle() {
    const {matches} = assertExists(useContext(DataRouterStateContext));
    return getRouteErrorTitle(matches[matches.length - 1]?.route.id ?? null);
}
