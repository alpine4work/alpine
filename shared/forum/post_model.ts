import {AccountModel} from "~/shared/accounts/account_model";
import {ContentReferencesSchema, emptyContentReferences} from "~/shared/content/content_references";
import {ChannelPreviewModel} from "~/shared/forum/channel_model";
import {PostContentSchema, emptyPostContent} from "~/shared/forum/post_content_schema";
import {PostId, SpaceId} from "~/shared/id/types/id_types";
import {MessageModel, MessagePayloadModelSchema} from "~/shared/messaging/message_model";
import {Model} from "~/shared/schema/model/model";
import {Schema, SchemaType} from "~/shared/schema/schema";

export type PostContentWithReferences = SchemaType<typeof PostContentWithReferencesSchema>;

export const PostContentWithReferencesSchema = Schema.object({
    doc: PostContentSchema,
    references: ContentReferencesSchema,
});

export const emptyPostContentWithReferences: PostContentWithReferences = {
    doc: emptyPostContent,
    references: emptyContentReferences,
};

export const maxPostPreviewCommentAuthorCount = 5;

/**
 * A post creates a thread of conversation in a channel. Users can write any
 * content they want in a post and it will be delivered to all members of a
 * channel through their inbox and feed.
 *
 * Other users can comment on the post and have a conversation. Post comments
 * include one level of threading.
 */
export class PostModel extends Model(
    Schema.object({
        id: Schema.id<PostId>(),
        spaceId: Schema.id<SpaceId>(),
        channel: ChannelPreviewModel.schema(),
        createdTime: Schema.date,
        author: AccountModel.schema(),
        content: PostContentWithReferencesSchema,
        contentUpdatedTime: Schema.date.nullable(),
        /**
         * The total number of comments on the post.
         */
        commentCount: Schema.integer,
        /**
         * The last time a comment on this post changed.
         */
        lastCommentChangeTime: Schema.date.nullable(),
        /**
         * The number of accounts who authored a comment on this post.
         */
        commentAuthorCount: Schema.integer,
        /**
         * Some of the authors who commented on this post. Only the first 5 or so. If
         * the length of this array is shorter than `commentAuthorCount` then you know
         * there are more authors we aren't including.
         */
        previewCommentAuthors: Schema.array(AccountModel.schema()),
    }),
) {}

/**
 * A comment on a post.
 */
export class PostCommentModel
    extends Model(
        Schema.object({
            postId: Schema.id<PostId>(),
            index: Schema.integer,
            author: AccountModel.schema(),
            createdTime: Schema.date,
            payload: MessagePayloadModelSchema,
        }),
    )
    implements MessageModel<PostId>
{
    // Make sure this property is available on this type and not just the
    // interface.
    public readonly isOptimistic?: undefined;

    public getRoomKey() {
        return this.postId;
    }
}
