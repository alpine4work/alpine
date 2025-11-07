import {useContext} from "react";
import {UNSAFE_DataRouterStateContext as DataRouterStateContext} from "react-router";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {AppSpaceRouteId} from "~/shared/remix/app_space_route_id.js";

const metadataByRouteId: Record<
    AppSpaceRouteId | "routes/switch-space",
    {readonly errorTitle: string; readonly spaceSideBarSpacing?: "Always" | "Never" | "Sometimes"}
> = {
    "routes/s.$spaceId._index": {
        errorTitle: "Couldn’t open space",
        spaceSideBarSpacing: "Always",
    },
    "routes/s.$spaceId.accounts.$accountId": {
        errorTitle: "Couldn’t open account",
    },
    "routes/s.$spaceId.channels.$channelId._index": {
        errorTitle: "Couldn’t open channel",
    },
    "routes/s.$spaceId.channels.$channelId.files": {
        errorTitle: "Couldn’t open files",
    },
    "routes/s.$spaceId.channels.new": {
        errorTitle: "Couldn’t create channel",
    },
    "routes/s.$spaceId.chat.$chatId._index": {
        errorTitle: "Couldn’t open chat",
    },
    "routes/s.$spaceId.chat.$chatId.messages.$index.reactions": {
        errorTitle: "Couldn’t open message reactions",
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
    "routes/s.$spaceId.dev.empty": {
        errorTitle: "Couldn’t open space",
    },
    "routes/s.$spaceId.documents.$documentId._index": {
        errorTitle: "Couldn’t open document",
        spaceSideBarSpacing: "Never",
    },
    "routes/s.$spaceId.documents.$documentId.comments.$commentThreadId._index": {
        errorTitle: "Couldn’t open comment thread",
    },
    "routes/s.$spaceId.documents.$documentId.comments.$commentThreadId.$index.reactions": {
        errorTitle: "Couldn’t open comment reactions",
    },
    "routes/s.$spaceId.favorites": {
        errorTitle: "Couldn’t open favorites",
    },
    "routes/s.$spaceId.inbox": {
        errorTitle: "Couldn’t open inbox",
        spaceSideBarSpacing: "Always",
    },
    "routes/s.$spaceId.invite._index": {
        errorTitle: "Couldn’t open invite",
    },
    "routes/s.$spaceId.invite.accept": {
        errorTitle: "Couldn’t accept invite",
    },
    "routes/s.$spaceId.invite.reject-and-mark-as-spam": {
        errorTitle: "Couldn’t reject invite",
        spaceSideBarSpacing: "Never",
    },
    "routes/s.$spaceId.more._index": {
        errorTitle: "Couldn’t open menu",
    },
    "routes/s.$spaceId.more.settings": {
        errorTitle: "Couldn’t open settings",
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
    "routes/s.$spaceId.notifications.unsubscribe": {
        errorTitle: "Couldn’t unsubscribe from email notification",
        spaceSideBarSpacing: "Never",
    },
    "routes/s.$spaceId.posts.$postId._index": {
        errorTitle: "Couldn’t open post",
    },
    "routes/s.$spaceId.posts.$postId.reactions": {
        errorTitle: "Couldn’t open post reactions",
    },
    "routes/s.$spaceId.posts.$postId.comments.$index.reactions": {
        errorTitle: "Couldn’t open comment reactions",
    },
    "routes/s.$spaceId.posts.new.$draftId": {
        errorTitle: "Couldn’t create post",
    },
    "routes/s.$spaceId.search": {
        errorTitle: "Couldn’t open search",
    },
    "routes/s.$spaceId.settings": {
        errorTitle: "Couldn’t open settings",
    },
    "routes/s.$spaceId.settings._index": {
        errorTitle: "Couldn’t open settings",
    },
    "routes/s.$spaceId.settings.general": {
        errorTitle: "Couldn’t open general settings",
    },
    "routes/s.$spaceId.settings.people": {
        errorTitle: "Couldn’t open people settings",
    },
    "routes/s.$spaceId.settings.profile": {
        errorTitle: "Couldn’t open profile settings",
    },
    "routes/s.$spaceId.settings.notifications": {
        errorTitle: "Couldn’t open notifications settings",
    },
    "routes/s.$spaceId.tasks.$taskId._index": {
        errorTitle: "Couldn’t open task",
    },
    "routes/s.$spaceId.tasks.$taskId.comments._index": {
        errorTitle: "Couldn’t open task",
    },
    "routes/s.$spaceId.tasks.$taskId.comments.$index.reactions": {
        errorTitle: "Couldn’t open comment reactions",
    },
    "routes/s.$spaceId.tasks._index": {
        errorTitle: "Couldn’t open tasks",
        spaceSideBarSpacing: "Always",
    },
    "routes/s.$spaceId.tasks.collections.$collectionId": {
        errorTitle: "Couldn’t open task collection",
        spaceSideBarSpacing: "Always",
    },
    "routes/s.$spaceId.tasks.view": {
        errorTitle: "Couldn’t open tasks",
        spaceSideBarSpacing: "Always",
    },
    "routes/switch-space": {
        errorTitle: "Couldn’t open menu",
    },
};

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
        ? cast<{[key: string]: (typeof metadataByRouteId)[AppSpaceRouteId]}>(metadataByRouteId)[
              routeId.replace(".peek.", ".")
          ]?.errorTitle
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
export function useSpaceSideBarSpacing(): "Always" | "Never" | "Sometimes" {
    const {matches} = assertExists(useContext(DataRouterStateContext));

    for (let i = matches.length - 1; i >= 0; i--) {
        const spaceSideBarSpacing = cast<{
            [key: string]: (typeof metadataByRouteId)[AppSpaceRouteId];
        }>(metadataByRouteId)[matches[i]!.route.id]?.spaceSideBarSpacing;

        if (spaceSideBarSpacing) return spaceSideBarSpacing;
    }

    return "Sometimes";
}
