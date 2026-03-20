import {useContext} from "react";
import {UNSAFE_DataRouterStateContext as DataRouterStateContext} from "react-router";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {AppSpaceRouteId} from "~/shared/remix/app_space_route_id.js";

const metadataByRouteId: Record<
    AppSpaceRouteId | "routes/switch-space",
    {
        readonly errorTitle: string;
        // Defaults to `Sometimes`
        readonly spaceSideBarSpacing?: "Always" | "Never" | "Sometimes";
    }
> = {
    "routes/s.$spaceId._index": {
        errorTitle: "Couldn\u2019t open space",
        spaceSideBarSpacing: "Always",
    },
    "routes/s.$spaceId.accounts.$accountId": {
        errorTitle: "Couldn\u2019t open account",
    },
    "routes/s.$spaceId.channels.$channelId._index": {
        errorTitle: "Couldn\u2019t open channel",
    },
    "routes/s.$spaceId.channels.$channelId.files": {
        errorTitle: "Couldn\u2019t open files",
    },
    "routes/s.$spaceId.channels.new": {
        errorTitle: "Couldn\u2019t create channel",
    },
    "routes/s.$spaceId.chat.$chatId._index": {
        errorTitle: "Couldn\u2019t open chat",
    },
    "routes/s.$spaceId.chat.$chatId.messages.$index.reactions": {
        errorTitle: "Couldn\u2019t open message reactions",
    },
    "routes/s.$spaceId.chat.new": {
        errorTitle: "Couldn\u2019t create chat",
    },
    "routes/s.$spaceId.chat.with.$accountId": {
        errorTitle: "Couldn\u2019t open chat",
    },
    "routes/s.$spaceId.create._index": {
        errorTitle: "Couldn\u2019t open menu",
    },
    "routes/s.$spaceId.databases.$databaseId.$tableOrViewId": {
        errorTitle: "Couldn\u2019t open table",
    },
    "routes/s.$spaceId.databases.$databaseId._index": {
        errorTitle: "Couldn\u2019t open database",
        spaceSideBarSpacing: "Always",
    },
    "routes/s.$spaceId.databases.$databaseId.sql": {
        errorTitle: "Couldn\u2019t open SQL editor",
    },
    "routes/s.$spaceId.databases.$databaseId": {
        errorTitle: "Couldn\u2019t open database",
        spaceSideBarSpacing: "Always",
    },
    "routes/s.$spaceId.databases.new": {
        errorTitle: "Couldn\u2019t create database",
    },
    "routes/s.$spaceId.create.more": {
        errorTitle: "Couldn\u2019t open menu",
    },
    "routes/s.$spaceId.dev.empty": {
        errorTitle: "Couldn\u2019t open space",
    },
    "routes/s.$spaceId.documents.$documentId._index": {
        errorTitle: "Couldn\u2019t open document",
        spaceSideBarSpacing: "Never",
    },
    "routes/s.$spaceId.documents.$documentId.comments.$commentThreadId._index": {
        errorTitle: "Couldn\u2019t open comment thread",
    },
    "routes/s.$spaceId.documents.$documentId.comments.$commentThreadId.$index.reactions": {
        errorTitle: "Couldn\u2019t open comment reactions",
    },
    "routes/s.$spaceId.documents.$documentId.duplicate": {
        errorTitle: "Couldn\u2019t duplicate document",
    },
    "routes/s.$spaceId.favorites": {
        errorTitle: "Couldn\u2019t open favorites",
    },
    "routes/s.$spaceId.inbox": {
        errorTitle: "Couldn\u2019t open inbox",
        spaceSideBarSpacing: "Always",
    },
    "routes/s.$spaceId.invite._index": {
        errorTitle: "Couldn\u2019t open invite",
    },
    "routes/s.$spaceId.invite.accept": {
        errorTitle: "Couldn\u2019t accept invite",
    },
    "routes/s.$spaceId.invite.reject-and-mark-as-spam": {
        errorTitle: "Couldn\u2019t reject invite",
        spaceSideBarSpacing: "Never",
    },
    "routes/s.$spaceId.more._index": {
        errorTitle: "Couldn\u2019t open menu",
    },
    "routes/s.$spaceId.more.settings": {
        errorTitle: "Couldn\u2019t open settings",
    },
    "routes/s.$spaceId.more.switch-space": {
        errorTitle: "Couldn\u2019t open menu",
    },
    "routes/s.$spaceId.notifications.channel-posts.$channelIdAndBucketGeneration": {
        errorTitle: "Couldn\u2019t open notification",
    },
    "routes/s.$spaceId.notifications.document-comment-threads.$documentIdAndBucketGeneration": {
        errorTitle: "Couldn\u2019t open notification",
    },
    "routes/s.$spaceId.notifications.unsubscribe": {
        errorTitle: "Couldn\u2019t unsubscribe from email notification",
        spaceSideBarSpacing: "Never",
    },
    "routes/s.$spaceId.posts.$postId._index": {
        errorTitle: "Couldn\u2019t open post",
    },
    "routes/s.$spaceId.posts.$postId.reactions": {
        errorTitle: "Couldn\u2019t open post reactions",
    },
    "routes/s.$spaceId.posts.$postId.comments.$index.reactions": {
        errorTitle: "Couldn\u2019t open comment reactions",
    },
    "routes/s.$spaceId.posts.new.$draftId": {
        errorTitle: "Couldn\u2019t create post",
    },
    "routes/s.$spaceId.search": {
        errorTitle: "Couldn\u2019t open search",
    },
    "routes/s.$spaceId.settings": {
        errorTitle: "Couldn\u2019t open settings",
    },
    "routes/s.$spaceId.settings._index": {
        errorTitle: "Couldn\u2019t open settings",
    },
    "routes/s.$spaceId.settings.bots._index": {
        errorTitle: "Couldn\u2019t open bot settings",
    },
    "routes/s.$spaceId.settings.bots.$botId": {
        errorTitle: "Couldn\u2019t open bot settings",
    },
    "routes/s.$spaceId.settings.general": {
        errorTitle: "Couldn\u2019t open general settings",
    },
    "routes/s.$spaceId.settings.integrations._index": {
        errorTitle: "Couldn\u2019t open integrations settings",
    },
    "routes/s.$spaceId.settings.integrations.import.notion": {
        errorTitle: "Couldn\u2019t open Notion import settings",
    },
    "routes/s.$spaceId.settings.integrations.slack": {
        errorTitle: "Couldn\u2019t open Slack integration settings",
    },
    "routes/s.$spaceId.settings.people": {
        errorTitle: "Couldn\u2019t open people settings",
    },
    "routes/s.$spaceId.settings.profile": {
        errorTitle: "Couldn\u2019t open profile settings",
    },
    "routes/s.$spaceId.settings.notifications": {
        errorTitle: "Couldn\u2019t open notifications settings",
    },
    "routes/s.$spaceId.tasks.$taskId._index": {
        errorTitle: "Couldn\u2019t open task",
    },
    "routes/s.$spaceId.tasks.$taskId.comments.$index.reactions": {
        errorTitle: "Couldn\u2019t open comment reactions",
    },
    "routes/s.$spaceId.tasks.$taskId.duplicate": {
        errorTitle: "Couldn\u2019t duplicate task",
    },
    "routes/s.$spaceId.tasks._index": {
        errorTitle: "Couldn\u2019t open tasks",
        spaceSideBarSpacing: "Always",
    },
    "routes/s.$spaceId.tasks.collections.$collectionId": {
        errorTitle: "Couldn\u2019t open task collection",
        spaceSideBarSpacing: "Always",
    },
    "routes/s.$spaceId.tasks.view": {
        errorTitle: "Couldn\u2019t open tasks",
        spaceSideBarSpacing: "Always",
    },
    "routes/switch-space": {
        errorTitle: "Couldn\u2019t open menu",
    },
};

/**
 * Get error title to use when the route error boundary catches an error. The
 * title is generally pretty generic like "Couldn't open document" and the
 * error is expected to provide a more detailed error message.
 *
 * We prefer using short, generic, language like "Couldn't open tasks" instead
 * of "Couldn't open task collection" so the user has less to parse when they
 * encounter an error.
 */
export function getRouteErrorTitle(routeId: string | null): string {
    const errorTitle = routeId
        ? cast<{[key: string]: (typeof metadataByRouteId)[AppSpaceRouteId]}>(metadataByRouteId)[
              routeId.replace(".peek.", ".")
          ]?.errorTitle
        : undefined;
    return errorTitle ?? "Couldn\u2019t open page";
}

/**
 * Get error title to use when the route error boundary catches an error. The
 * title is generally pretty generic like "Couldn't open document" and the
 * error is expected to provide a more detailed error message.
 *
 * We prefer using short, generic, language like "Couldn't open tasks" instead
 * of "Couldn't open task collection" so the user has less to parse when they
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
