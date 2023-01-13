// TODO(calebmer): Posts table.
export {};
// import {DynamoKeyAttributeSchema} from "~/server/dynamo/internal/dynamo_key_attribute_schema";
// import {DynamoTableSchema} from "~/server/dynamo/internal/dynamo_table_schema";
// import {PostContentSchema} from "~/shared/posts/post_content_schema";
// import {Schema} from "~/shared/schema/schema";
//
// const PostsTable = DynamoTableSchema.new({
//     name: "Posts",
//     partitions: {
//         Post: {
//             partitionKeyAttributes: {
//                 postId: DynamoKeyAttributeSchema.id,
//             },
//             sortRanges: {
//                 Attributes: {
//                     sortKeyAttributes: {},
//                     attributes: Schema.object({
//                         spaceId: Schema.id,

//                         /**
//                          * What channel was this posted in?
//                          *
//                          * Must have the same `spaceId` as this post. We include the `spaceId` in this
//                          * item in case we ever have posts that are not a part of a channel. Posts that
//                          * aren't a part of a channel should still be part of a space.
//                          */
//                         channelId: Schema.id,

//                         /** When was this post created? */
//                         createdTime: Schema.date,

//                         /** Which account created this post? */
//                         authorAccountId: Schema.id,

//                         /** The contents of this post. */
//                         content: PostContentSchema,
//                     }),
//                 },
//             },
//         },
//     },
// });
