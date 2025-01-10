import {useContext} from "react";
import {UNSAFE_DataRouterStateContext as DataRouterStateContext} from "react-router";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";

const metadataByRouteId: {
    readonly [key: string]: {readonly errorTitle: string; readonly isFullWidth?: true} | undefined;
} = {
    "routes/s.$spaceId._index": {
        errorTitle: "Couldn’t open home",
    },
    "routes/s.$spaceId.channels.$channelId._index": {
        errorTitle: "Couldn’t open channel",
    },
    "routes/s.$spaceId.channels.$channelId.files": {
        errorTitle: "Couldn’t open files",
    },
    "routes/s.$spaceId.chat.$chatId": {
        errorTitle: "Couldn’t open chat",
    },
    "routes/s.$spaceId.chat.new": {
        errorTitle: "Couldn’t create chat",
    },
    "routes/s.$spaceId.chat.with.$accountId": {
        errorTitle: "Couldn’t open chat",
    },
    "routes/s.$spaceId.create._index": {
        errorTitle: "Couldn’t open menu",
    },
    "routes/s.$spaceId.create.more": {
        errorTitle: "Couldn’t open menu",
    },
    "routes/s.$spaceId.documents.$documentId._index": {
        errorTitle: "Couldn’t open document",
    },
    "routes/s.$spaceId.documents.$documentId.comments.$commentThreadId": {
        errorTitle: "Couldn’t open comment thread",
    },
    "routes/s.$spaceId.inbox": {
        errorTitle: "Couldn’t open inbox",
        isFullWidth: true,
    },
    "routes/s.$spaceId.more._index": {
        errorTitle: "Couldn’t open menu",
    },
    "routes/s.$spaceId.more.switch-space": {
        errorTitle: "Couldn’t open menu",
    },
    "routes/s.$spaceId.notifications.channel-posts.$channelIdAndBucketGeneration": {
        errorTitle: "Couldn’t open notification",
    },
    "routes/s.$spaceId.notifications.document-comment-threads.$documentIdAndBucketGeneration": {
        errorTitle: "Couldn’t open notification",
    },
    "routes/s.$spaceId.posts.$postId": {
        errorTitle: "Couldn’t open post",
    },
    "routes/s.$spaceId.posts.new.$draftId": {
        errorTitle: "Couldn’t create post",
    },
    "routes/s.$spaceId.search": {
        errorTitle: "Couldn’t open search",
    },
    "routes/s.$spaceId.tasks.$taskId._index": {
        errorTitle: "Couldn’t open task",
    },
    "routes/s.$spaceId.tasks.$taskId.comments": {
        errorTitle: "Couldn’t open task",
    },
    "routes/s.$spaceId.tasks._index": {
        errorTitle: "Couldn’t open tasks",
        isFullWidth: true,
    },
    "routes/s.$spaceId.tasks.collections.$collectionId": {
        errorTitle: "Couldn’t open tasks",
        isFullWidth: true,
    },
    "routes/s.$spaceId.tasks.view": {
        errorTitle: "Couldn’t open tasks",
        isFullWidth: true,
    },
    "routes/switch-space": {
        errorTitle: "Couldn’t open menu",
    },
};

export function getRouteIdsWithDefinedMetadataForTest() {
    assert(import.meta.jest);
    return Object.keys(metadataByRouteId);
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
    const errorTitle = routeId
        ? metadataByRouteId[routeId.replace(".peek.", ".")]?.errorTitle
        : undefined;
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

/**
 * Are we in a full width route? A full width route is one where the route's
 * contents extend from the left edge of the screen to the right edge of the
 * screen. The space sidebar does not contribute width to routes which aren't
 * full width which allows us to center non-full width route contents.
 */
export function useIsFullWidthRoute() {
    const {matches} = assertExists(useContext(DataRouterStateContext));
    return matches.some(match => metadataByRouteId[match.route.id]?.isFullWidth);
}
