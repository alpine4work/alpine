import {
    File,
    Gif,
    Image,
    ListBullets,
    ListChecks,
    ListNumbers,
    Minus,
    Table,
    TextHOne,
    TextHThree,
    TextHTwo,
} from "phosphor-react";
import {Schema as ProsemirrorSchema} from "prosemirror-model";
import {Selection} from "prosemirror-state";
import {EditorView} from "prosemirror-view";
import {ReactNode, RefObject} from "react";
import {
    insertContentCheckListItem,
    insertContentCodeBlock,
    insertContentDivider,
    insertContentFiles,
    insertContentHeading,
    insertContentOrderedListItem,
    insertContentQuoteBlock,
    insertContentTable,
    insertContentUnorderedListItem,
} from "~/client/web/content/internal/content_editor_insert.js";
import {selectFiles} from "~/client/web/content/select_files.js";
import {MenuStandardAction} from "~/client/web/design/menu.js";
import {CodeBlockIcon} from "~/client/web/icons/code_block_icon.js";
import {QuoteBlockIcon} from "~/client/web/icons/quote_block_icon.js";
import {VideoIcon} from "~/client/web/icons/video_icon.js";
import {WaveformIcon} from "~/client/web/icons/waveform_icon.js";
import {
    getFileAudioContentTypes,
    getFileImageContentTypes,
    getFileVideoContentTypes,
} from "~/shared/files/file_content_type.open_source.js";
import {scheduleUncaughtError} from "~/shared/helpers/async/schedule_uncaught_error.open_source.js";
import {assertAssignableTypes} from "~/shared/helpers/control/assert_assignable_types.open_source.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";

export type ContentEditorInsertMenuAction = {
    readonly label: string;
    readonly icon: ReactNode;
    readonly isSuggestedInMentionFloater: boolean;
    readonly onPress: () => void;
    /**
     * Additional keywords that should match this action in fuzzy search. For example,
     * `["meme"]` on the GIF action lets users type `@meme` to find it.
     */
    readonly searchKeywords?: ReadonlyArray<string>;
};

assertAssignableTypes<ContentEditorInsertMenuAction, MenuStandardAction>();

/**
 * Return menu actions for the right click insert submenu. These insert actions
 * also show up when you hit @ and start typing (but without dividers between
 * sections). When you hit @ we show some suggested items. We only suggest insert
 * actions with `isSuggestedInMentionFloater: true`. The goal is to have less than
 * one full scroll window of suggested insert actions.
 */
export function getContentEditorInsertMenuActions({
    schema,
    viewRef,
    getSelection,
    alwaysDeleteSelection,
    onOpenGifPicker,
}: {
    schema: ProsemirrorSchema;
    viewRef: RefObject<
        | (EditorView & {
              insertFiles: (posOrSelection: number | Selection, files: ReadonlyArray<File>) => void;
          })
        | null
    >;
    getSelection?: () => Selection;
    alwaysDeleteSelection?: boolean;
    onOpenGifPicker?: () => void;
}): ReadonlyArray<ReadonlyArray<ContentEditorInsertMenuAction>> {
    const insertMenuActions: Array<Array<ContentEditorInsertMenuAction>> = [];

    if (schema.nodes.file) {
        insertMenuActions.push([
            {
                label: "Image",
                icon: <Image />,
                isSuggestedInMentionFloater: true,
                onPress: () => {
                    selectFiles(assertExists(viewRef.current?.dom.parentElement), {
                        multiple: true,
                        acceptContentTypes: getFileImageContentTypes(),
                    })
                        .then(files => {
                            if (files.length === 0) return;
                            if (!viewRef.current) return;
                            insertContentFiles(viewRef.current, files, getSelection?.());
                        })
                        .catch(scheduleUncaughtError);
                },
            },
            {
                label: "Video",
                icon: <VideoIcon />,
                isSuggestedInMentionFloater: false,
                onPress: () => {
                    selectFiles(assertExists(viewRef.current?.dom.parentElement), {
                        multiple: true,
                        acceptContentTypes: getFileVideoContentTypes(),
                    })
                        .then(files => {
                            if (files.length === 0) return;
                            if (!viewRef.current) return;
                            insertContentFiles(viewRef.current, files, getSelection?.());
                        })
                        .catch(scheduleUncaughtError);
                },
            },
            {
                label: "Audio",
                icon: <WaveformIcon />,
                isSuggestedInMentionFloater: false,
                onPress: () => {
                    selectFiles(assertExists(viewRef.current?.dom.parentElement), {
                        multiple: true,
                        acceptContentTypes: getFileAudioContentTypes(),
                    })
                        .then(files => {
                            if (files.length === 0) return;
                            if (!viewRef.current) return;
                            insertContentFiles(viewRef.current, files, getSelection?.());
                        })
                        .catch(scheduleUncaughtError);
                },
            },
            {
                label: "File",
                icon: <File />,
                isSuggestedInMentionFloater: false,
                onPress: () => {
                    selectFiles(assertExists(viewRef.current?.dom.parentElement), {
                        multiple: true,
                    })
                        .then(files => {
                            if (files.length === 0) return;
                            if (!viewRef.current) return;
                            insertContentFiles(viewRef.current, files, getSelection?.());
                        })
                        .catch(scheduleUncaughtError);
                },
            },
        ]);
    }

    if (onOpenGifPicker) {
        insertMenuActions.push([
            {
                label: "GIF",
                icon: <Gif />,
                isSuggestedInMentionFloater: false,
                searchKeywords: ["meme"],
                onPress: () => {
                    // Delete the `@gif` text before opening the picker.
                    const selection = getSelection?.();
                    if (selection) {
                        const view = assertExists(viewRef.current);
                        view.dispatch(view.state.tr.deleteRange(selection.from, selection.to));
                    }
                    onOpenGifPicker();
                },
            },
        ]);
    }

    const insertListMenuActions: Array<ContentEditorInsertMenuAction> = [];
    insertMenuActions.push(insertListMenuActions);

    insertListMenuActions.push(
        {
            label: "Bullet list",
            icon: <ListBullets />,
            isSuggestedInMentionFloater: true,
            onPress: () => {
                insertContentUnorderedListItem(assertExists(viewRef.current), getSelection?.(), {
                    alwaysDeleteSelection,
                });
            },
        },
        {
            label: "Number list",
            icon: <ListNumbers />,
            isSuggestedInMentionFloater: true,
            onPress: () => {
                insertContentOrderedListItem(assertExists(viewRef.current), getSelection?.(), {
                    alwaysDeleteSelection,
                });
            },
        },
    );

    if (schema.nodes.checkListItem) {
        insertListMenuActions.push({
            label: "Check list",
            icon: <ListChecks />,
            isSuggestedInMentionFloater: false,
            onPress: () => {
                insertContentCheckListItem(assertExists(viewRef.current), getSelection?.(), {
                    alwaysDeleteSelection,
                });
            },
        });
    }

    if (schema.nodes.heading) {
        insertMenuActions.push([
            {
                label: "Heading 1",
                icon: <TextHOne />,
                isSuggestedInMentionFloater: true,
                onPress: () => {
                    insertContentHeading(assertExists(viewRef.current), 1, getSelection?.(), {
                        alwaysDeleteSelection,
                    });
                },
            },
            {
                label: "Heading 2",
                icon: <TextHTwo />,
                isSuggestedInMentionFloater: true,
                onPress: () => {
                    insertContentHeading(assertExists(viewRef.current), 2, getSelection?.(), {
                        alwaysDeleteSelection,
                    });
                },
            },
            {
                label: "Heading 3",
                icon: <TextHThree />,
                isSuggestedInMentionFloater: false,
                onPress: () => {
                    insertContentHeading(assertExists(viewRef.current), 3, getSelection?.(), {
                        alwaysDeleteSelection,
                    });
                },
            },
        ]);
    }

    const insertOtherMenuActions: Array<ContentEditorInsertMenuAction> = [];
    insertMenuActions.push(insertOtherMenuActions);

    insertOtherMenuActions.push({
        label: "Table",
        icon: <Table />,
        isSuggestedInMentionFloater: true,
        onPress: () => {
            insertContentTable(assertExists(viewRef.current), getSelection?.());
        },
    });

    if (schema.nodes.divider) {
        insertOtherMenuActions.push({
            label: "Divider",
            icon: <Minus />,
            isSuggestedInMentionFloater: true,
            onPress: () => {
                insertContentDivider(assertExists(viewRef.current), getSelection?.());
            },
        });
    }

    insertOtherMenuActions.push(
        {
            label: "Quote block",
            icon: <QuoteBlockIcon />,
            isSuggestedInMentionFloater: false,
            onPress: () => {
                insertContentQuoteBlock(assertExists(viewRef.current), getSelection?.());
            },
        },
        {
            label: "Code block",
            icon: <CodeBlockIcon />,
            isSuggestedInMentionFloater: false,
            onPress: () => {
                insertContentCodeBlock(assertExists(viewRef.current), getSelection?.());
            },
        },
    );

    return insertMenuActions;
}
