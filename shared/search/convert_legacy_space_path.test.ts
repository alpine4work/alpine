import {NonEmptyReadonlyArray} from "~/shared/helpers/array/non_empty_readonly_array.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {UrlPath} from "~/shared/helpers/http/url_path.js";
import {convertLegacySpacePath} from "~/shared/search/convert_legacy_space_path.js";

type LegacySpaceRoute =
    | "s.$spaceId._index.tsx"
    | "s.$spaceId.accounts.$accountId.tsx"
    | "s.$spaceId.channels.$channelId._index.tsx"
    | "s.$spaceId.channels.$channelId.files.tsx"
    | "s.$spaceId.channels.new.tsx"
    | "s.$spaceId.chat.$chatId._index.tsx"
    | "s.$spaceId.chat.$chatId.messages.$index.reactions.tsx"
    | "s.$spaceId.chat.new.tsx"
    | "s.$spaceId.chat.room.new.tsx"
    | "s.$spaceId.chat.with.$accountId.tsx"
    | "s.$spaceId.create._index.tsx"
    | "s.$spaceId.create.more.tsx"
    | "s.$spaceId.databases.$tableOrViewId.tsx"
    | "s.$spaceId.databases._index.tsx"
    | "s.$spaceId.databases.new.tsx"
    | "s.$spaceId.databases.sql.tsx"
    | "s.$spaceId.dev.empty.tsx"
    | "s.$spaceId.dev.feed.tsx"
    | "s.$spaceId.documents.$documentId._index.tsx"
    | "s.$spaceId.documents.$documentId.comments.$commentThreadId._index.tsx"
    | "s.$spaceId.documents.$documentId.comments.$commentThreadId.$index.reactions.tsx"
    | "s.$spaceId.documents.$documentId.duplicate.tsx"
    | "s.$spaceId.favorites.tsx"
    | "s.$spaceId.inbox.tsx"
    | "s.$spaceId.integrations.slack.oauth.tsx"
    | "s.$spaceId.invite._index.tsx"
    | "s.$spaceId.invite.accept.tsx"
    | "s.$spaceId.invite.reject-and-mark-as-spam.tsx"
    | "s.$spaceId.more._index.tsx"
    | "s.$spaceId.more.settings.tsx"
    | "s.$spaceId.more.switch-space.tsx"
    | "s.$spaceId.notifications.channel-posts.$channelIdAndBucketGeneration.tsx"
    | "s.$spaceId.notifications.document-comment-threads.$documentIdAndBucketGeneration.tsx"
    | "s.$spaceId.notifications.unsubscribe.tsx"
    | "s.$spaceId.peek.channels.$channelId._index.tsx"
    | "s.$spaceId.peek.channels.$channelId.files.tsx"
    | "s.$spaceId.peek.channels.new.tsx"
    | "s.$spaceId.peek.chat.$chatId._index.tsx"
    | "s.$spaceId.peek.chat.$chatId.messages.$index.reactions.tsx"
    | "s.$spaceId.peek.chat.new.tsx"
    | "s.$spaceId.peek.chat.room.new.tsx"
    | "s.$spaceId.peek.chat.with.$accountId.tsx"
    | "s.$spaceId.peek.databases.$tableOrViewId.tsx"
    | "s.$spaceId.peek.documents.$documentId._index.tsx"
    | "s.$spaceId.peek.documents.$documentId.comments.$commentThreadId._index.tsx"
    | "s.$spaceId.peek.documents.$documentId.comments.$commentThreadId.$index.reactions.tsx"
    | "s.$spaceId.peek.documents.$documentId.duplicate.tsx"
    | "s.$spaceId.peek.favorites.ts"
    | "s.$spaceId.peek.notifications.channel-posts.$channelIdAndBucketGeneration.tsx"
    | "s.$spaceId.peek.notifications.document-comment-threads.$documentIdAndBucketGeneration.tsx"
    | "s.$spaceId.peek.posts.$postId._index.tsx"
    | "s.$spaceId.peek.posts.$postId.comments.$index.reactions.tsx"
    | "s.$spaceId.peek.posts.$postId.reactions.tsx"
    | "s.$spaceId.peek.posts.new.$draftId.tsx"
    | "s.$spaceId.peek.sites.$siteId._index.tsx"
    | "s.$spaceId.peek.tasks._index.tsx"
    | "s.$spaceId.peek.tasks.$taskId._index.tsx"
    | "s.$spaceId.peek.tasks.$taskId.comments.$index.reactions.tsx"
    | "s.$spaceId.peek.tasks.$taskId.duplicate.tsx"
    | "s.$spaceId.peek.tasks.collections.$collectionId.tsx"
    | "s.$spaceId.peek.tasks.view.tsx"
    | "s.$spaceId.peek.tsx"
    | "s.$spaceId.posts.$postId._index.tsx"
    | "s.$spaceId.posts.$postId.comments.$index.reactions.tsx"
    | "s.$spaceId.posts.$postId.reactions.tsx"
    | "s.$spaceId.posts.new.$draftId.tsx"
    | "s.$spaceId.search.tsx"
    | "s.$spaceId.settings._index.tsx"
    | "s.$spaceId.settings.bots._index.tsx"
    | "s.$spaceId.settings.bots.$botId.tsx"
    | "s.$spaceId.settings.general.tsx"
    | "s.$spaceId.settings.integrations._index.tsx"
    | "s.$spaceId.settings.integrations.notion.tsx"
    | "s.$spaceId.settings.integrations.slack.tsx"
    | "s.$spaceId.settings.notifications.tsx"
    | "s.$spaceId.settings.people.tsx"
    | "s.$spaceId.settings.profile.tsx"
    | "s.$spaceId.settings.tsx"
    | "s.$spaceId.sites.$siteId._index.tsx"
    | "s.$spaceId.tasks._index.tsx"
    | "s.$spaceId.tasks.$taskId._index.tsx"
    | "s.$spaceId.tasks.$taskId.comments.$index.reactions.tsx"
    | "s.$spaceId.tasks.$taskId.duplicate.tsx"
    | "s.$spaceId.tasks.collections.$collectionId.tsx"
    | "s.$spaceId.tasks.view.tsx"
    | "s.$spaceId.tsx";

const testCases: Record<LegacySpaceRoute, NonEmptyReadonlyArray<{old: string; new: string}>> = {
    "s.$spaceId._index.tsx": [
        {
            old: "/s/c2pwxmpv3z7b3db19tsn6y1qfg",
            new: "/home/c2pwxmpv3z7b3db19tsn6y1qfg",
        },
    ],
    "s.$spaceId.accounts.$accountId.tsx": [
        {
            old: "/s/c2pwxmpv3z7b3db19tsn6y1qfg/accounts/a93hre935d0yd7akahtrwcvv30",
            new: "/account/a93hre935d0yd7akahtrwcvv30/c2pwxmpv3z7b3db19tsn6y1qfg",
        },
    ],
    "s.$spaceId.channels.$channelId._index.tsx": [
        {
            old: "/s/c2pwxmpv3z7b3db19tsn6y1qfg/channels/c93hre935d0yd7akahtrwcvv30",
            new: "/channel/c93hre935d0yd7akahtrwcvv30",
        },
    ],
    "s.$spaceId.channels.$channelId.files.tsx": [
        {
            old: "/s/c2pwxmpv3z7b3db19tsn6y1qfg/channels/c93hre935d0yd7akahtrwcvv30/files",
            new: "/channel/c93hre935d0yd7akahtrwcvv30/files",
        },
    ],
    "s.$spaceId.channels.new.tsx": [
        {
            old: "/s/c2pwxmpv3z7b3db19tsn6y1qfg/channels/new",
            new: "/channel/new/c2pwxmpv3z7b3db19tsn6y1qfg",
        },
    ],
    "s.$spaceId.chat.$chatId._index.tsx": [
        {
            old: "/s/c2pwxmpv3z7b3db19tsn6y1qfg/chat/ch3hre935d0yd7akahtrwcvv30",
            new: "/chat/ch3hre935d0yd7akahtrwcvv30",
        },
    ],
    "s.$spaceId.chat.$chatId.messages.$index.reactions.tsx": [
        {
            old: "/s/c2pwxmpv3z7b3db19tsn6y1qfg/chat/ch3hre935d0yd7akahtrwcvv30/messages/0/reactions",
            new: "/chat/ch3hre935d0yd7akahtrwcvv30/message/0/reactions",
        },
    ],
    "s.$spaceId.chat.new.tsx": [
        {
            old: "/s/c2pwxmpv3z7b3db19tsn6y1qfg/chat/new",
            new: "/chat/new/c2pwxmpv3z7b3db19tsn6y1qfg",
        },
    ],
    "s.$spaceId.chat.room.new.tsx": [
        {
            old: "/s/c2pwxmpv3z7b3db19tsn6y1qfg/chat/room/new",
            new: "/chat/room/new/c2pwxmpv3z7b3db19tsn6y1qfg",
        },
    ],
    "s.$spaceId.chat.with.$accountId.tsx": [
        {
            old: "/s/c2pwxmpv3z7b3db19tsn6y1qfg/chat/with/a93hre935d0yd7akahtrwcvv30",
            new: "/chat/with/a93hre935d0yd7akahtrwcvv30/c2pwxmpv3z7b3db19tsn6y1qfg",
        },
    ],
    "s.$spaceId.create._index.tsx": [
        {
            old: "/s/c2pwxmpv3z7b3db19tsn6y1qfg/create",
            new: "/create/c2pwxmpv3z7b3db19tsn6y1qfg",
        },
    ],
    "s.$spaceId.create.more.tsx": [
        {
            old: "/s/c2pwxmpv3z7b3db19tsn6y1qfg/create/more",
            new: "/create/c2pwxmpv3z7b3db19tsn6y1qfg/more",
        },
    ],
    "s.$spaceId.databases.$tableOrViewId.tsx": [
        {
            old: "/s/c2pwxmpv3z7b3db19tsn6y1qfg/databases/d93hre935d0yd7akahtrwcvv30",
            new: "/databases/c2pwxmpv3z7b3db19tsn6y1qfg/d93hre935d0yd7akahtrwcvv30",
        },
    ],
    "s.$spaceId.databases._index.tsx": [
        {
            old: "/s/c2pwxmpv3z7b3db19tsn6y1qfg/databases",
            new: "/databases/c2pwxmpv3z7b3db19tsn6y1qfg",
        },
    ],
    "s.$spaceId.databases.new.tsx": [
        {
            old: "/s/c2pwxmpv3z7b3db19tsn6y1qfg/databases/new",
            new: "/databases/c2pwxmpv3z7b3db19tsn6y1qfg/new",
        },
    ],
    "s.$spaceId.databases.sql.tsx": [
        {
            old: "/s/c2pwxmpv3z7b3db19tsn6y1qfg/databases/sql",
            new: "/databases/c2pwxmpv3z7b3db19tsn6y1qfg/sql",
        },
    ],
    "s.$spaceId.dev.empty.tsx": [
        {
            old: "/s/c2pwxmpv3z7b3db19tsn6y1qfg/dev/empty",
            new: "/dev/empty/c2pwxmpv3z7b3db19tsn6y1qfg",
        },
    ],
    "s.$spaceId.dev.feed.tsx": [
        {
            old: "/s/c2pwxmpv3z7b3db19tsn6y1qfg/dev/feed",
            new: "/dev/feed/c2pwxmpv3z7b3db19tsn6y1qfg",
        },
    ],
    "s.$spaceId.documents.$documentId._index.tsx": [
        {
            old: "/s/c2pwxmpv3z7b3db19tsn6y1qfg/documents/d93hre935d0yd7akahtrwcvv30",
            new: "/doc/d93hre935d0yd7akahtrwcvv30",
        },
        {
            old: "/s/c2pwxmpv3z7b3db19tsn6y1qfg/documents/d93hre935d0yd7akahtrwcvv30?comments=dcthre935d0yd7akahtrwcvv30",
            new: "/doc/d93hre935d0yd7akahtrwcvv30?thread=dcthre935d0yd7akahtrwcvv30",
        },
    ],
    "s.$spaceId.documents.$documentId.comments.$commentThreadId._index.tsx": [
        {
            old: "/s/c2pwxmpv3z7b3db19tsn6y1qfg/documents/d93hre935d0yd7akahtrwcvv30/comments/dcthre935d0yd7akahtrwcvv30",
            new: "/doc/d93hre935d0yd7akahtrwcvv30/thread/dcthre935d0yd7akahtrwcvv30",
        },
        {
            old: "/s/c2pwxmpv3z7b3db19tsn6y1qfg/documents/d93hre935d0yd7akahtrwcvv30/comments/dcthre935d0yd7akahtrwcvv30?inbox=show",
            new: "/doc/d93hre935d0yd7akahtrwcvv30/thread/dcthre935d0yd7akahtrwcvv30?inbox=show",
        },
    ],
    "s.$spaceId.documents.$documentId.comments.$commentThreadId.$index.reactions.tsx": [
        {
            old: "/s/c2pwxmpv3z7b3db19tsn6y1qfg/documents/d93hre935d0yd7akahtrwcvv30/comments/dcthre935d0yd7akahtrwcvv30/0/reactions",
            new: "/doc/d93hre935d0yd7akahtrwcvv30/thread/dcthre935d0yd7akahtrwcvv30/comment/0/reactions",
        },
    ],
    "s.$spaceId.documents.$documentId.duplicate.tsx": [
        {
            old: "/s/c2pwxmpv3z7b3db19tsn6y1qfg/documents/d93hre935d0yd7akahtrwcvv30/duplicate",
            new: "/doc/d93hre935d0yd7akahtrwcvv30/duplicate",
        },
    ],
    "s.$spaceId.favorites.tsx": [
        {
            old: "/s/c2pwxmpv3z7b3db19tsn6y1qfg/favorites",
            new: "/favorites/c2pwxmpv3z7b3db19tsn6y1qfg",
        },
    ],
    "s.$spaceId.inbox.tsx": [
        {
            old: "/s/c2pwxmpv3z7b3db19tsn6y1qfg/inbox",
            new: "/inbox/c2pwxmpv3z7b3db19tsn6y1qfg",
        },
    ],
    "s.$spaceId.integrations.slack.oauth.tsx": [
        {
            old: "/s/c2pwxmpv3z7b3db19tsn6y1qfg/integrations/slack/oauth",
            new: "/integrations/slack/oauth/c2pwxmpv3z7b3db19tsn6y1qfg",
        },
    ],
    "s.$spaceId.invite._index.tsx": [
        {
            old: "/s/c2pwxmpv3z7b3db19tsn6y1qfg/invite/",
            new: "/invite/c2pwxmpv3z7b3db19tsn6y1qfg",
        },
    ],
    "s.$spaceId.invite.accept.tsx": [
        {
            old: "/s/c2pwxmpv3z7b3db19tsn6y1qfg/invite/accept",
            new: "/invite/c2pwxmpv3z7b3db19tsn6y1qfg/accept",
        },
    ],
    "s.$spaceId.invite.reject-and-mark-as-spam.tsx": [
        {
            old: "/s/c2pwxmpv3z7b3db19tsn6y1qfg/invite/reject-and-mark-as-spam",
            new: "/invite/c2pwxmpv3z7b3db19tsn6y1qfg/reject-and-mark-as-spam",
        },
    ],
    "s.$spaceId.more._index.tsx": [
        {
            old: "/s/c2pwxmpv3z7b3db19tsn6y1qfg/more",
            new: "/more/c2pwxmpv3z7b3db19tsn6y1qfg",
        },
    ],
    "s.$spaceId.more.settings.tsx": [
        {
            old: "/s/c2pwxmpv3z7b3db19tsn6y1qfg/more/settings",
            new: "/more/settings/c2pwxmpv3z7b3db19tsn6y1qfg",
        },
    ],
    "s.$spaceId.more.switch-space.tsx": [
        {
            old: "/s/c2pwxmpv3z7b3db19tsn6y1qfg/more/switch-space",
            new: "/more/switch-space/c2pwxmpv3z7b3db19tsn6y1qfg",
        },
    ],
    "s.$spaceId.notifications.channel-posts.$channelIdAndBucketGeneration.tsx": [
        {
            old: "/s/c2pwxmpv3z7b3db19tsn6y1qfg/notifications/channel-posts/c93hre935d0yd7akahtrwcvv30-0",
            new: "/notifications/channel-posts/c93hre935d0yd7akahtrwcvv30-0",
        },
    ],
    "s.$spaceId.notifications.document-comment-threads.$documentIdAndBucketGeneration.tsx": [
        {
            old: "/s/c2pwxmpv3z7b3db19tsn6y1qfg/notifications/document-comment-threads/d93hre935d0yd7akahtrwcvv30-0",
            new: "/notifications/document-threads/d93hre935d0yd7akahtrwcvv30-0",
        },
    ],
    "s.$spaceId.notifications.unsubscribe.tsx": [
        {
            old: "/s/c2pwxmpv3z7b3db19tsn6y1qfg/notifications/unsubscribe",
            new: "/notifications/unsubscribe/c2pwxmpv3z7b3db19tsn6y1qfg",
        },
    ],
    "s.$spaceId.peek.channels.$channelId._index.tsx": [
        {
            old: "/s/c2pwxmpv3z7b3db19tsn6y1qfg/peek/channels/c93hre935d0yd7akahtrwcvv30",
            new: "/peek/channel/c93hre935d0yd7akahtrwcvv30",
        },
    ],
    "s.$spaceId.peek.channels.$channelId.files.tsx": [
        {
            old: "/s/c2pwxmpv3z7b3db19tsn6y1qfg/peek/channels/c93hre935d0yd7akahtrwcvv30/files",
            new: "/peek/channel/c93hre935d0yd7akahtrwcvv30/files",
        },
    ],
    "s.$spaceId.peek.channels.new.tsx": [
        {
            old: "/s/c2pwxmpv3z7b3db19tsn6y1qfg/peek/channels/new",
            new: "/peek/channel/new/c2pwxmpv3z7b3db19tsn6y1qfg",
        },
    ],
    "s.$spaceId.peek.chat.$chatId._index.tsx": [
        {
            old: "/s/c2pwxmpv3z7b3db19tsn6y1qfg/peek/chat/ch3hre935d0yd7akahtrwcvv30",
            new: "/peek/chat/ch3hre935d0yd7akahtrwcvv30",
        },
    ],
    "s.$spaceId.peek.chat.$chatId.messages.$index.reactions.tsx": [
        {
            old: "/s/c2pwxmpv3z7b3db19tsn6y1qfg/peek/chat/ch3hre935d0yd7akahtrwcvv30/messages/0/reactions",
            new: "/peek/chat/ch3hre935d0yd7akahtrwcvv30/message/0/reactions",
        },
    ],
    "s.$spaceId.peek.chat.new.tsx": [
        {
            old: "/s/c2pwxmpv3z7b3db19tsn6y1qfg/peek/chat/new",
            new: "/peek/chat/new/c2pwxmpv3z7b3db19tsn6y1qfg",
        },
    ],
    "s.$spaceId.peek.chat.room.new.tsx": [
        {
            old: "/s/c2pwxmpv3z7b3db19tsn6y1qfg/peek/chat/room/new",
            new: "/peek/chat/room/new/c2pwxmpv3z7b3db19tsn6y1qfg",
        },
    ],
    "s.$spaceId.peek.chat.with.$accountId.tsx": [
        {
            old: "/s/c2pwxmpv3z7b3db19tsn6y1qfg/peek/chat/with/a93hre935d0yd7akahtrwcvv30",
            new: "/peek/chat/with/a93hre935d0yd7akahtrwcvv30/c2pwxmpv3z7b3db19tsn6y1qfg",
        },
    ],
    "s.$spaceId.peek.databases.$tableOrViewId.tsx": [
        {
            old: "/s/c2pwxmpv3z7b3db19tsn6y1qfg/peek/databases/d93hre935d0yd7akahtrwcvv30",
            new: "/peek/databases/c2pwxmpv3z7b3db19tsn6y1qfg/d93hre935d0yd7akahtrwcvv30",
        },
    ],
    "s.$spaceId.peek.documents.$documentId._index.tsx": [
        {
            old: "/s/c2pwxmpv3z7b3db19tsn6y1qfg/peek/documents/d93hre935d0yd7akahtrwcvv30",
            new: "/peek/doc/d93hre935d0yd7akahtrwcvv30",
        },
    ],
    "s.$spaceId.peek.documents.$documentId.comments.$commentThreadId._index.tsx": [
        {
            old: "/s/c2pwxmpv3z7b3db19tsn6y1qfg/peek/documents/d93hre935d0yd7akahtrwcvv30/comments/dcthre935d0yd7akahtrwcvv30",
            new: "/peek/doc/d93hre935d0yd7akahtrwcvv30/thread/dcthre935d0yd7akahtrwcvv30",
        },
    ],
    "s.$spaceId.peek.documents.$documentId.comments.$commentThreadId.$index.reactions.tsx": [
        {
            old: "/s/c2pwxmpv3z7b3db19tsn6y1qfg/peek/documents/d93hre935d0yd7akahtrwcvv30/comments/dcthre935d0yd7akahtrwcvv30/0/reactions",
            new: "/peek/doc/d93hre935d0yd7akahtrwcvv30/thread/dcthre935d0yd7akahtrwcvv30/comment/0/reactions",
        },
    ],
    "s.$spaceId.peek.documents.$documentId.duplicate.tsx": [
        {
            old: "/s/c2pwxmpv3z7b3db19tsn6y1qfg/peek/documents/d93hre935d0yd7akahtrwcvv30/duplicate",
            new: "/peek/doc/d93hre935d0yd7akahtrwcvv30/duplicate",
        },
    ],
    "s.$spaceId.peek.favorites.ts": [
        {
            old: "/s/c2pwxmpv3z7b3db19tsn6y1qfg/peek/favorites",
            new: "/peek/favorites/c2pwxmpv3z7b3db19tsn6y1qfg",
        },
    ],
    "s.$spaceId.peek.notifications.channel-posts.$channelIdAndBucketGeneration.tsx": [
        {
            old: "/s/c2pwxmpv3z7b3db19tsn6y1qfg/peek/notifications/channel-posts/c93hre935d0yd7akahtrwcvv30-0",
            new: "/peek/notifications/channel-posts/c93hre935d0yd7akahtrwcvv30-0",
        },
    ],
    "s.$spaceId.peek.notifications.document-comment-threads.$documentIdAndBucketGeneration.tsx": [
        {
            old: "/s/c2pwxmpv3z7b3db19tsn6y1qfg/peek/notifications/document-comment-threads/d93hre935d0yd7akahtrwcvv30-0",
            new: "/peek/notifications/document-threads/d93hre935d0yd7akahtrwcvv30-0",
        },
    ],
    "s.$spaceId.peek.posts.$postId._index.tsx": [
        {
            old: "/s/c2pwxmpv3z7b3db19tsn6y1qfg/peek/posts/p93hre935d0yd7akahtrwcvv30",
            new: "/peek/post/p93hre935d0yd7akahtrwcvv30",
        },
    ],
    "s.$spaceId.peek.posts.$postId.comments.$index.reactions.tsx": [
        {
            old: "/s/c2pwxmpv3z7b3db19tsn6y1qfg/peek/posts/p93hre935d0yd7akahtrwcvv30/comments/0/reactions",
            new: "/peek/post/p93hre935d0yd7akahtrwcvv30/comment/0/reactions",
        },
    ],
    "s.$spaceId.peek.posts.$postId.reactions.tsx": [
        {
            old: "/s/c2pwxmpv3z7b3db19tsn6y1qfg/peek/posts/p93hre935d0yd7akahtrwcvv30/reactions",
            new: "/peek/post/p93hre935d0yd7akahtrwcvv30/reactions",
        },
    ],
    "s.$spaceId.peek.posts.new.$draftId.tsx": [
        {
            old: "/s/c2pwxmpv3z7b3db19tsn6y1qfg/peek/posts/new/dr3hre935d0yd7akahtrwcvv30",
            new: "/peek/post/new/dr3hre935d0yd7akahtrwcvv30/c2pwxmpv3z7b3db19tsn6y1qfg",
        },
    ],
    "s.$spaceId.peek.sites.$siteId._index.tsx": [
        {
            old: "/s/c2pwxmpv3z7b3db19tsn6y1qfg/peek/sites/s93hre935d0yd7akahtrwcvv30",
            new: "/peek/site/s93hre935d0yd7akahtrwcvv30",
        },
    ],
    "s.$spaceId.peek.tasks._index.tsx": [
        {
            old: "/s/c2pwxmpv3z7b3db19tsn6y1qfg/peek/tasks",
            new: "/peek/my-tasks/c2pwxmpv3z7b3db19tsn6y1qfg",
        },
    ],
    "s.$spaceId.peek.tasks.$taskId._index.tsx": [
        {
            old: "/s/c2pwxmpv3z7b3db19tsn6y1qfg/peek/tasks/t93hre935d0yd7akahtrwcvv30",
            new: "/peek/task/t93hre935d0yd7akahtrwcvv30",
        },
    ],
    "s.$spaceId.peek.tasks.$taskId.comments.$index.reactions.tsx": [
        {
            old: "/s/c2pwxmpv3z7b3db19tsn6y1qfg/peek/tasks/t93hre935d0yd7akahtrwcvv30/comments/0/reactions",
            new: "/peek/task/t93hre935d0yd7akahtrwcvv30/comment/0/reactions",
        },
    ],
    "s.$spaceId.peek.tasks.$taskId.duplicate.tsx": [
        {
            old: "/s/c2pwxmpv3z7b3db19tsn6y1qfg/peek/tasks/t93hre935d0yd7akahtrwcvv30/duplicate",
            new: "/peek/task/t93hre935d0yd7akahtrwcvv30/duplicate",
        },
    ],
    "s.$spaceId.peek.tasks.collections.$collectionId.tsx": [
        {
            old: "/s/c2pwxmpv3z7b3db19tsn6y1qfg/peek/tasks/collections/tc3hre935d0yd7akahtrwcvv30",
            new: "/peek/task-collection/tc3hre935d0yd7akahtrwcvv30",
        },
    ],
    "s.$spaceId.peek.tasks.view.tsx": [
        {
            old: "/s/c2pwxmpv3z7b3db19tsn6y1qfg/peek/tasks/view",
            new: "/peek/task-view/new/c2pwxmpv3z7b3db19tsn6y1qfg",
        },
    ],
    "s.$spaceId.peek.tsx": [
        {
            old: "/s/c2pwxmpv3z7b3db19tsn6y1qfg/peek",
            new: "/peek",
        },
    ],
    "s.$spaceId.posts.$postId._index.tsx": [
        {
            old: "/s/c2pwxmpv3z7b3db19tsn6y1qfg/posts/p93hre935d0yd7akahtrwcvv30",
            new: "/post/p93hre935d0yd7akahtrwcvv30",
        },
    ],
    "s.$spaceId.posts.$postId.comments.$index.reactions.tsx": [
        {
            old: "/s/c2pwxmpv3z7b3db19tsn6y1qfg/posts/p93hre935d0yd7akahtrwcvv30/comments/0/reactions",
            new: "/post/p93hre935d0yd7akahtrwcvv30/comment/0/reactions",
        },
    ],
    "s.$spaceId.posts.$postId.reactions.tsx": [
        {
            old: "/s/c2pwxmpv3z7b3db19tsn6y1qfg/posts/p93hre935d0yd7akahtrwcvv30/reactions",
            new: "/post/p93hre935d0yd7akahtrwcvv30/reactions",
        },
    ],
    "s.$spaceId.posts.new.$draftId.tsx": [
        {
            old: "/s/c2pwxmpv3z7b3db19tsn6y1qfg/posts/new/dr3hre935d0yd7akahtrwcvv30",
            new: "/post/new/dr3hre935d0yd7akahtrwcvv30/c2pwxmpv3z7b3db19tsn6y1qfg",
        },
    ],
    "s.$spaceId.search.tsx": [
        {
            old: "/s/c2pwxmpv3z7b3db19tsn6y1qfg/search",
            new: "/search/c2pwxmpv3z7b3db19tsn6y1qfg",
        },
    ],
    "s.$spaceId.settings._index.tsx": [
        {
            old: "/s/c2pwxmpv3z7b3db19tsn6y1qfg/settings",
            new: "/settings/c2pwxmpv3z7b3db19tsn6y1qfg",
        },
    ],
    "s.$spaceId.settings.bots._index.tsx": [
        {
            old: "/s/c2pwxmpv3z7b3db19tsn6y1qfg/settings/bots",
            new: "/settings/c2pwxmpv3z7b3db19tsn6y1qfg/bots",
        },
    ],
    "s.$spaceId.settings.bots.$botId.tsx": [
        {
            old: "/s/c2pwxmpv3z7b3db19tsn6y1qfg/settings/bots/b93hre935d0yd7akahtrwcvv30",
            new: "/settings/c2pwxmpv3z7b3db19tsn6y1qfg/bots/b93hre935d0yd7akahtrwcvv30",
        },
    ],
    "s.$spaceId.settings.general.tsx": [
        {
            old: "/s/c2pwxmpv3z7b3db19tsn6y1qfg/settings/general",
            new: "/settings/c2pwxmpv3z7b3db19tsn6y1qfg/general",
        },
    ],
    "s.$spaceId.settings.integrations._index.tsx": [
        {
            old: "/s/c2pwxmpv3z7b3db19tsn6y1qfg/settings/integrations",
            new: "/settings/c2pwxmpv3z7b3db19tsn6y1qfg/integrations",
        },
    ],
    "s.$spaceId.settings.integrations.notion.tsx": [
        {
            old: "/s/c2pwxmpv3z7b3db19tsn6y1qfg/settings/integrations/notion",
            new: "/settings/c2pwxmpv3z7b3db19tsn6y1qfg/integrations/notion",
        },
    ],
    "s.$spaceId.settings.integrations.slack.tsx": [
        {
            old: "/s/c2pwxmpv3z7b3db19tsn6y1qfg/settings/integrations/slack",
            new: "/settings/c2pwxmpv3z7b3db19tsn6y1qfg/integrations/slack",
        },
    ],
    "s.$spaceId.settings.notifications.tsx": [
        {
            old: "/s/c2pwxmpv3z7b3db19tsn6y1qfg/settings/notifications",
            new: "/settings/c2pwxmpv3z7b3db19tsn6y1qfg/notifications",
        },
    ],
    "s.$spaceId.settings.people.tsx": [
        {
            old: "/s/c2pwxmpv3z7b3db19tsn6y1qfg/settings/people",
            new: "/settings/c2pwxmpv3z7b3db19tsn6y1qfg/people",
        },
    ],
    "s.$spaceId.settings.profile.tsx": [
        {
            old: "/s/c2pwxmpv3z7b3db19tsn6y1qfg/settings/profile",
            new: "/settings/c2pwxmpv3z7b3db19tsn6y1qfg/profile",
        },
    ],
    "s.$spaceId.settings.tsx": [
        {
            old: "/s/c2pwxmpv3z7b3db19tsn6y1qfg/settings/",
            new: "/settings/c2pwxmpv3z7b3db19tsn6y1qfg",
        },
    ],
    "s.$spaceId.sites.$siteId._index.tsx": [
        {
            old: "/s/c2pwxmpv3z7b3db19tsn6y1qfg/sites/s93hre935d0yd7akahtrwcvv30",
            new: "/site/s93hre935d0yd7akahtrwcvv30",
        },
    ],
    "s.$spaceId.tasks._index.tsx": [
        {
            old: "/s/c2pwxmpv3z7b3db19tsn6y1qfg/tasks",
            new: "/my-tasks/c2pwxmpv3z7b3db19tsn6y1qfg",
        },
    ],
    "s.$spaceId.tasks.$taskId._index.tsx": [
        {
            old: "/s/c2pwxmpv3z7b3db19tsn6y1qfg/tasks/t93hre935d0yd7akahtrwcvv30",
            new: "/task/t93hre935d0yd7akahtrwcvv30",
        },
    ],
    "s.$spaceId.tasks.$taskId.comments.$index.reactions.tsx": [
        {
            old: "/s/c2pwxmpv3z7b3db19tsn6y1qfg/tasks/t93hre935d0yd7akahtrwcvv30/comments/0/reactions",
            new: "/task/t93hre935d0yd7akahtrwcvv30/comment/0/reactions",
        },
    ],
    "s.$spaceId.tasks.$taskId.duplicate.tsx": [
        {
            old: "/s/c2pwxmpv3z7b3db19tsn6y1qfg/tasks/t93hre935d0yd7akahtrwcvv30/duplicate",
            new: "/task/t93hre935d0yd7akahtrwcvv30/duplicate",
        },
    ],
    "s.$spaceId.tasks.collections.$collectionId.tsx": [
        {
            old: "/s/c2pwxmpv3z7b3db19tsn6y1qfg/tasks/collections/tc3hre935d0yd7akahtrwcvv30",
            new: "/task-collection/tc3hre935d0yd7akahtrwcvv30",
        },
    ],
    "s.$spaceId.tasks.view.tsx": [
        {
            old: "/s/c2pwxmpv3z7b3db19tsn6y1qfg/tasks/view",
            new: "/task-view/new/c2pwxmpv3z7b3db19tsn6y1qfg",
        },
    ],
    "s.$spaceId.tsx": [
        {
            old: "/s/c2pwxmpv3z7b3db19tsn6y1qfg/",
            new: "/home/c2pwxmpv3z7b3db19tsn6y1qfg",
        },
    ],
};

for (const testCases2 of Object.values(testCases)) {
    for (const testCase of testCases2) {
        test(`\`${testCase.old}\` -> \`${testCase.new}\``, () => {
            const result = assertExists(convertLegacySpacePath(new UrlPath(testCase.old)));

            expect(result.pathname + result.search).toBe(testCase.new);
        });
    }
}
