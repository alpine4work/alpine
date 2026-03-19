import {useMemo} from "react";
import {AccountAvatar} from "~/client/web/accounts/account_avatar.js";
import {useAccountModel} from "~/client/web/accounts/account_registry_context.js";
import {useContentBlockWidth} from "~/client/web/content/content_block_width.js";
import {ContentFileEntityPreview} from "~/client/web/content/content_file_entity_preview_component.js";
import {Box} from "~/client/web/design/box.js";
import {PrettyAbsoluteDate} from "~/client/web/design/pretty_absolute_date.js";
import {Spacer} from "~/client/web/design/spacer.js";
import {useSpacingScale} from "~/client/web/remix/spacing_scale_context.js";
import {documentCommentThreadPreviewHeight} from "~/client/web/styles/document_shared_styles.js";
import {
    feedEntryHeight,
    postContentViewHeaderAvatarSize,
    postContentViewInnerMarginY,
    postContentViewOuterMarginY,
} from "~/client/web/styles/forum_shared_styles.js";
import {sprinkles} from "~/client/web/styles/styles.js";
import {FileChatEntityModelSchema} from "~/shared/chat/file_chat_entity_model_schema.js";
import {convertRemLengthToPx, screenPaddingX} from "~/shared/design/core/spacing.js";
import {FileDocumentEntityModelSchema} from "~/shared/documents/file_document_entity_model_schema.js";
import {
    FeedEntryModel,
    FeedPostEntryModel,
    FeedWelcomeEntryModel,
} from "~/shared/feed/feed_entry_model.js";
import {FileEntityIdObject, parseFileEntityId} from "~/shared/files/file_entity_id.js";
import {FileEntityModel} from "~/shared/files/file_entity_model.js";
import {getFileEntityNoun} from "~/shared/files/get_file_entity_noun.js";
import {FileChannelEntityModelSchema} from "~/shared/forum/file_channel_entity_model_schema.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {FileTaskCollectionEntityModelSchema} from "~/shared/tasks/file_task_collection_entity_model.js";
import {FileTaskEntityModelSchema} from "~/shared/tasks/file_task_entity_model.js";

export function FeedFileEntityEntryView({
    entry,
}: {
    entry: Exclude<FeedEntryModel, FeedWelcomeEntryModel | FeedPostEntryModel>;
}) {
    const spacingScale = useSpacingScale();

    const blockWidth = useContentBlockWidth();
    const height = useMemo(
        () => convertRemLengthToPx(documentCommentThreadPreviewHeight, spacingScale),
        [spacingScale],
    );

    const {fileEntityId, fileEntityType, fileEntityResult} = useMemo(() => {
        const fileEntityId = entry.getId();
        const fileEntityType = parseFileEntityId(fileEntityId).type;

        let fileEntity: FileEntityModel;

        switch (entry.type) {
            case "Document": {
                fileEntity = new FileEntityModel(FileDocumentEntityModelSchema, {
                    ...entry.document,
                    type: "Document",
                });
                break;
            }
            case "TaskCollection": {
                fileEntity = new FileEntityModel(FileTaskCollectionEntityModelSchema, {
                    ...entry.collection,
                    type: "TaskCollection",
                });
                break;
            }
            case "Task": {
                fileEntity = new FileEntityModel(FileTaskEntityModelSchema, {
                    ...entry.task,
                    type: "Task",
                });
                break;
            }
            case "Channel": {
                fileEntity = new FileEntityModel(FileChannelEntityModelSchema, {
                    ...entry.channel,
                    type: "Channel",
                });
                break;
            }
            case "Chat": {
                fileEntity = new FileEntityModel(FileChatEntityModelSchema, {
                    ...entry.chat,
                    type: "Chat",
                });
                break;
            }
            default:
                throw exhaustive(entry);
        }

        return {
            fileEntityId,
            fileEntityType,
            fileEntityResult: {ok: true, value: fileEntity} as const,
        };
    }, [entry]);

    return (
        <Box
            paddingX={screenPaddingX}
            paddingY={postContentViewOuterMarginY}
            style={{height: feedEntryHeight}}
        >
            <Box display="flex" height={postContentViewHeaderAvatarSize}>
                <AccountAvatar account={entry.sharer} size={postContentViewHeaderAvatarSize} />
                <Box paddingLeft={{mobile: "2", desktop: "3"}} overflow="hidden">
                    <Box fontSize="75" fontStyle="truncate" color="grey-70">
                        <span className={sprinkles({color: "grey-100", fontStyle: "semi-bold"})}>
                            {useAccountModel(entry.sharer).name}
                        </span>{" "}
                        {getFeedEntryEventMessage(entry.event, fileEntityType)}
                    </Box>
                    <Box fontSize="50" fontStyle="truncate" color="grey-50">
                        <PrettyAbsoluteDate tooltipPlacement="bottom" date={entry.sharedTime} />
                    </Box>
                </Box>
            </Box>
            <Spacer space={postContentViewInnerMarginY} />
            <Box width="full" style={{height}}>
                <ContentFileEntityPreview
                    height={height}
                    width={blockWidth}
                    blockWidth={blockWidth}
                    fileEntityId={fileEntityId}
                    fileEntityResult={fileEntityResult}
                />
            </Box>
        </Box>
    );
}

function getFeedEntryEventMessage(
    event: Exclude<FeedEntryModel, FeedWelcomeEntryModel | FeedPostEntryModel>["event"],
    fileEntityType: FileEntityIdObject["type"],
) {
    switch (event) {
        case "Created":
            return `created a ${getFileEntityNoun(fileEntityType)}`;
        case "SharedWithAccessPolicyDefaultGrant":
            return `shared a ${getFileEntityNoun(fileEntityType)}`;
        case "SharedProjectLayoutWithInheritedAccessPolicyDefaultGrant":
            return "shared a project";
        case "UpdatedToProjectLayout":
            return "created a project";
        default:
            throw exhaustive(event);
    }
}
