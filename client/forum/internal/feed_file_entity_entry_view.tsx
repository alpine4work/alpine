import {useMemo} from "react";
import {AccountAvatar} from "~/client/accounts/account_avatar.js";
import {useAccountModel} from "~/client/accounts/account_registry_context.js";
import {ContentFileEntityPreview} from "~/client/content/content_file_entity_preview_component.js";
import {getContentBlockWidth} from "~/client/content/state/get_content_block_width.js";
import {Box} from "~/client/design/box.js";
import {PrettyAbsoluteDate} from "~/client/design/pretty_absolute_date.js";
import {Spacer} from "~/client/design/spacer.js";
import {useClientInfo} from "~/client/remix/client_info_context.js";
import {usePlatform} from "~/client/remix/platform_context.js";
import {useRouteLayout} from "~/client/remix/route_layout_context.js";
import {useSpacingScale} from "~/client/remix/spacing_scale_context.js";
import {documentCommentThreadPreviewHeight} from "~/client/styles/document_shared_styles.js";
import {
    feedEntryHeight,
    postContentViewHeaderAvatarSize,
    postContentViewInnerMarginY,
    postContentViewOuterMarginY,
} from "~/client/styles/forum_shared_styles.js";
import {sprinkles} from "~/client/styles/styles.js";
import {convertRemLengthToPx, screenPaddingX} from "~/shared/design/core/spacing.js";
import {FileDocumentEntityModelSchema} from "~/shared/documents/file_document_entity_model_schema.js";
import {
    FeedEntryModel,
    FeedPostEntryModel,
    FeedWelcomeEntryModel,
} from "~/shared/feed/feed_entry_model.js";
import {FeedEntryEvent} from "~/shared/feed/feed_entry_schema.js";
import {parseFileEntityId} from "~/shared/files/file_entity_id.js";
import {FileEntityModel} from "~/shared/files/file_entity_model.js";
import {getFileEntityNoun} from "~/shared/files/get_file_entity_noun.js";
import {FileChannelEntityModelSchema} from "~/shared/forum/file_channel_entity_model_schema.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {FileTaskCollectionEntityModelSchema} from "~/shared/tasks/file_task_collection_entity_model.js";

export function FeedFileEntityEntryView({
    entry,
    availableWidth,
}: {
    entry: Exclude<FeedEntryModel, FeedWelcomeEntryModel | FeedPostEntryModel>;
    availableWidth?: number;
}) {
    const spacingScale = useSpacingScale();
    const platform = usePlatform();
    const clientInfo = useClientInfo();
    const routeLayout = useRouteLayout();

    const {height, blockWidth} = useMemo(
        () => ({
            height: convertRemLengthToPx(documentCommentThreadPreviewHeight, spacingScale),
            blockWidth: getContentBlockWidth({
                spacingScale,
                platform,
                routeLayout,
                clientInfo,
                availableWidth:
                    availableWidth !== undefined
                        ? availableWidth -
                          convertRemLengthToPx(screenPaddingX[platform], spacingScale) * 2
                        : undefined,
            }),
        }),
        [availableWidth, clientInfo, platform, routeLayout, spacingScale],
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
            case "Channel": {
                fileEntity = new FileEntityModel(FileChannelEntityModelSchema, {
                    ...entry.channel,
                    type: "Channel",
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
                        {getFeedEntryEventMessage(entry.event)} a{" "}
                        {getFileEntityNoun(fileEntityType)}
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

function getFeedEntryEventMessage(event: FeedEntryEvent) {
    switch (event) {
        case "Created":
            return "created";
        case "SharedWithAccessPolicyDefaultGrant":
            return "shared";
        default:
            throw exhaustive(event);
    }
}
