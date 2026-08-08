import {useContext} from "react";
import {UNSAFE_DataRouterStateContext as DataRouterStateContext} from "react-router";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {AppSpaceRouteId} from "~/shared/remix/app_space_route_id.js";

type AppRouteWithMetadataId =
    | AppSpaceRouteId
    | "routes/invite.$spaceId._index"
    | "routes/invite.$spaceId.accept"
    | "routes/invite.$spaceId.reject-and-mark-as-spam"
    | "routes/switch-space"
    | "routes/account.$accountId.$spaceId"
    | "routes/mention.$accountId";

const metadataByRouteId: Record<
    AppRouteWithMetadataId,
    {
        readonly errorTitle: string;
    }
> = {
    "routes/_space.home.$spaceId._index": {
        errorTitle: "Couldn\u2019t open space",
    },
    "routes/_space.channel.$channelId._index": {
        errorTitle: "Couldn\u2019t open channel",
    },
    "routes/_space.channel.$channelId.files": {
        errorTitle: "Couldn\u2019t open files",
    },
    "routes/_space.channel.new.$spaceId": {
        errorTitle: "Couldn\u2019t create channel",
    },
    "routes/_space.chat.$chatId._index": {
        errorTitle: "Couldn\u2019t open chat",
    },
    "routes/_space.chat.$chatId.message.$index.reactions": {
        errorTitle: "Couldn\u2019t open message reactions",
    },
    "routes/_space.chat.new.$spaceId": {
        errorTitle: "Couldn\u2019t create chat",
    },
    "routes/_space.chat.room.new.$spaceId": {
        errorTitle: "Couldn\u2019t create chat",
    },
    "routes/_space.chat.with.$accountId.$spaceId": {
        errorTitle: "Couldn\u2019t open chat",
    },
    "routes/_space.create.$spaceId._index": {
        errorTitle: "Couldn\u2019t open menu",
    },
    "routes/_space.create.$spaceId.more": {
        errorTitle: "Couldn\u2019t open menu",
    },
    "routes/_space.database.$tableOrViewId": {
        errorTitle: "Couldn\u2019t open table",
    },
    "routes/_space.database.new.$spaceId": {
        errorTitle: "Couldn\u2019t create database",
    },
    "routes/_space.database.query.$spaceId": {
        errorTitle: "Couldn\u2019t query database",
    },
    "routes/_space.dev.empty.$spaceId": {
        errorTitle: "Couldn\u2019t open space",
    },
    "routes/_space.dev.feed.$spaceId": {
        errorTitle: "Couldn\u2019t open space",
    },
    "routes/_space.doc.$documentId._index": {
        errorTitle: "Couldn\u2019t open document",
    },
    "routes/_space.doc.$documentId.thread.$commentThreadId._index": {
        errorTitle: "Couldn\u2019t open comment thread",
    },
    "routes/_space.doc.$documentId.thread.$commentThreadId.comment.$index.reactions": {
        errorTitle: "Couldn\u2019t open comment reactions",
    },
    "routes/_space.doc.$documentId.duplicate": {
        errorTitle: "Couldn\u2019t duplicate document",
    },
    "routes/_space.favorites.$spaceId": {
        errorTitle: "Couldn\u2019t open favorites",
    },
    "routes/_space.inbox.$spaceId": {
        errorTitle: "Couldn\u2019t open inbox",
    },
    "routes/invite.$spaceId._index": {
        errorTitle: "Couldn\u2019t open invite",
    },
    "routes/invite.$spaceId.accept": {
        errorTitle: "Couldn\u2019t accept invite",
    },
    "routes/invite.$spaceId.reject-and-mark-as-spam": {
        errorTitle: "Couldn\u2019t reject invite",
    },
    "routes/_space.more.$spaceId": {
        errorTitle: "Couldn\u2019t open menu",
    },
    "routes/_space.more.settings.$spaceId": {
        errorTitle: "Couldn\u2019t open settings",
    },
    "routes/_space.more.switch-space.$spaceId": {
        errorTitle: "Couldn\u2019t open menu",
    },
    "routes/_space.notifications.channel-posts.$channelIdAndBucketGeneration": {
        errorTitle: "Couldn\u2019t open notification",
    },
    "routes/_space.notifications.document-threads.$documentIdAndBucketGeneration": {
        errorTitle: "Couldn\u2019t open notification",
    },
    "routes/_space.notifications.unsubscribe.$spaceId": {
        errorTitle: "Couldn\u2019t unsubscribe from email notification",
    },
    "routes/_space.post.$postId._index": {
        errorTitle: "Couldn\u2019t open post",
    },
    "routes/_space.post.$postId.reactions": {
        errorTitle: "Couldn\u2019t open post reactions",
    },
    "routes/_space.post.$postId.comment.$index.reactions": {
        errorTitle: "Couldn\u2019t open comment reactions",
    },
    "routes/_space.post.new.$draftId.$spaceId": {
        errorTitle: "Couldn\u2019t create post",
    },
    "routes/_space.search.$spaceId": {
        errorTitle: "Couldn\u2019t open search",
    },
    "routes/_space.settings.$spaceId": {
        errorTitle: "Couldn\u2019t open settings",
    },
    "routes/_space.settings.$spaceId._index": {
        errorTitle: "Couldn\u2019t open settings",
    },
    "routes/_space.settings.$spaceId.bots._index": {
        errorTitle: "Couldn\u2019t open bot settings",
    },
    "routes/_space.settings.$spaceId.bots.$botId": {
        errorTitle: "Couldn\u2019t open bot settings",
    },
    "routes/_space.settings.$spaceId.general": {
        errorTitle: "Couldn\u2019t open general settings",
    },
    "routes/_space.settings.$spaceId.integrations._index": {
        errorTitle: "Couldn\u2019t open integrations settings",
    },
    "routes/_space.settings.$spaceId.integrations.notion": {
        errorTitle: "Couldn\u2019t open Notion import settings",
    },
    "routes/_space.settings.$spaceId.integrations.slack": {
        errorTitle: "Couldn\u2019t open Slack integration settings",
    },
    "routes/_space.integrations.slack.oauth.$spaceId": {
        errorTitle: "Couldn\u2019t complete Slack authorization",
    },
    "routes/_space.settings.$spaceId.people": {
        errorTitle: "Couldn\u2019t open people settings",
    },
    "routes/_space.settings.$spaceId.profile": {
        errorTitle: "Couldn\u2019t open profile settings",
    },
    "routes/_space.settings.$spaceId.notifications": {
        errorTitle: "Couldn\u2019t open notifications settings",
    },
    "routes/_space.site.$siteId._index": {
        errorTitle: "Couldn\u2019t open site",
    },
    "routes/_space.site.$siteId.navigate": {
        errorTitle: "Couldn\u2019t open site",
    },
    "routes/_space.task.$taskId._index": {
        errorTitle: "Couldn\u2019t open task",
    },
    "routes/_space.task.$taskId.comment.$index.reactions": {
        errorTitle: "Couldn\u2019t open comment reactions",
    },
    "routes/_space.task.$taskId.duplicate": {
        errorTitle: "Couldn\u2019t duplicate task",
    },
    "routes/_space.my-tasks.$spaceId": {
        errorTitle: "Couldn\u2019t open tasks",
    },
    "routes/_space.task-collection.$collectionId": {
        errorTitle: "Couldn\u2019t open task collection",
    },
    "routes/_space.task-view.new.$spaceId": {
        errorTitle: "Couldn\u2019t open tasks",
    },
    "routes/switch-space": {
        errorTitle: "Couldn\u2019t open menu",
    },
    "routes/account.$accountId.$spaceId": {
        errorTitle: "Couldn\u2019t open account",
    },
    "routes/mention.$accountId": {
        errorTitle: "Couldn\u2019t open account",
    },
};

/**
 * Get error title to use when the route error boundary catches an error. The title
 * is generally pretty generic like "Couldn't open document" and the error is
 * expected to provide a more detailed error message.
 *
 * We prefer using short, generic, language like "Couldn't open tasks" instead of
 * "Couldn't open task collection" so the user has less to parse when they
 * encounter an error.
 */
export function getRouteErrorTitle(routeId: string | null): string {
    const errorTitle = routeId
        ? cast<{[key: string]: (typeof metadataByRouteId)[AppRouteWithMetadataId]}>(
              metadataByRouteId,
          )[routeId.replace(".peek.", ".")]?.errorTitle
        : undefined;
    return errorTitle ?? "Couldn\u2019t open page";
}

/**
 * Get error title to use when the route error boundary catches an error. The title
 * is generally pretty generic like "Couldn't open document" and the error is
 * expected to provide a more detailed error message.
 *
 * We prefer using short, generic, language like "Couldn't open tasks" instead of
 * "Couldn't open task collection" so the user has less to parse when they
 * encounter an error.
 */
export function useRouteErrorTitle() {
    const {matches} = assertExists(useContext(DataRouterStateContext));
    return getRouteErrorTitle(matches[matches.length - 1]?.route.id ?? null);
}
