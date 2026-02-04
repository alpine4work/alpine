import {
    Dispatch,
    Ref,
    SetStateAction,
    memo,
    useEffect,
    useId,
    useImperativeHandle,
    useMemo,
    useRef,
    useState,
} from "react";
import {ContentEditor, ContentEditorRef} from "~/client/web/content/content_editor.js";
import {ContentEditorState} from "~/client/web/content/state/content_editor_state.js";
import {Box} from "~/client/web/design/box.js";
import {Button} from "~/client/web/design/button.js";
import {FocusRing} from "~/client/web/design/focus_ring.js";
import {navigationBarHeight} from "~/client/web/design/navigation_bar_helpers.js";
import {OverlayScopeContextProvider} from "~/client/web/design/overlay_scope_context_provider.js";
import {scheduleAfterNavigationAnimation} from "~/client/web/design/schedule_after_navigation_animation.js";
import {useScrollbar} from "~/client/web/design/scrollbar.js";
import {TextInput} from "~/client/web/design/text_input.js";
import {useMergedRefs} from "~/client/web/helpers/refs/use_merged_refs.js";
import {useNavigationBar} from "~/client/web/navigation/navigation_bar.js";
import {useSpacingScale} from "~/client/web/remix/spacing_scale_context.js";
import {useNavigate} from "~/client/web/remix/use_navigate.js";
import {
    channelCreatorDescriptionFieldMinHeightPx,
    channelCreatorDescriptionFieldPaddingX,
    channelCreatorDescriptionFieldPaddingY,
    channelCreatorGap,
    channelCreatorMarginTop,
} from "~/client/web/styles/forum_shared_styles.js";
import {peekNarrowLayoutWidth} from "~/client/web/styles/peek_shared_styles.js";
import {sprinkles} from "~/client/web/styles/styles.js";
import {screenPaddingX} from "~/shared/design/core/spacing.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {filterMapIterable} from "~/shared/helpers/iterable/filter_map_iterable.js";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.js";
import {emptyMap} from "~/shared/helpers/map/empty_map.js";
import {
    ContentDuplicationVariableSchema,
    ContentDuplicationVariableSchemaContentProperty,
    ContentDuplicationVariableSchemaProperty,
    ContentDuplicationVariableSchemaTextProperty,
    ContentDuplicationVariableValues,
    ContentDuplicationVariableValuesProperty,
} from "~/shared/messaging/content_duplication_variable_schema.js";
import {
    MessageContentWithReferences,
    emptyMessageContentWithReferences,
} from "~/shared/messaging/message_content_schema.js";

/**
 * A generic content duplication view that can be used for both documents and tasks.
 * It renders a form for the user to fill in variable values, then calls the
 * `onDuplicate` callback to perform the duplication.
 */
export function ContentDuplicationView({
    title,
    defaultPreviousRoute,
    variableSchema,
    onDuplicate,
}: {
    title: string;
    defaultPreviousRoute: string;
    variableSchema: ContentDuplicationVariableSchema;
    onDuplicate: (values: ContentDuplicationVariableValues) => Promise<string>;
}) {
    const navigate = useNavigate();

    const [textValues, setTextValues] = useState<ReadonlyMap<string, string>>(emptyMap);

    const [contentStates, setContentStates] = useState<
        ReadonlyMap<string, ContentEditorState<MessageContentWithReferences>>
    >(() => {
        return new Map(
            filterMapIterable(variableSchema, ([name, propertySchema]) => {
                if (propertySchema.type !== "Content") return;
                return [name, ContentEditorState.create(emptyMessageContentWithReferences)];
            }),
        );
    });

    const buttonRef = useRef<HTMLButtonElement & {press(): void}>(null);

    const firstPropertyRef = useRef<ContentDuplicationViewPropertyRef>(null);

    const hasInitiallyMountedRef = useRef(false);
    useEffect(() => {
        if (hasInitiallyMountedRef.current) return;
        hasInitiallyMountedRef.current = true;

        if (variableSchema.size === 0) return;

        const firstProperty = assertExists(firstPropertyRef.current);

        return scheduleAfterNavigationAnimation(() => {
            firstProperty.focus();
        });
    }, [variableSchema.size]);

    const {scrollViewRef, navigationBar, scrollbarInsetTop} = useNavigationBar({
        title: `Duplicate \u201C${title}\u201D`,
        defaultPreviousRoute,
        withoutDisappearingTitle: true,
        replaceActions: (
            <Box display="flex" justifyContent="flex-end">
                <Button
                    ref={buttonRef}
                    variant="neutral"
                    fontSize="100"
                    pressErrorTitle="Couldn&#x2019;t duplicate"
                    onPress={async () => {
                        const values = new Map<string, ContentDuplicationVariableValuesProperty>();

                        for (const [name, propertySchema] of variableSchema) {
                            switch (propertySchema.type) {
                                case "Text": {
                                    const textValue = textValues.get(name);
                                    values.set(name, {
                                        type: "Text",
                                        text: textValue ?? "",
                                        marks: propertySchema.marks,
                                    });
                                    break;
                                }
                                case "Content": {
                                    const contentState = assertExists(contentStates.get(name));
                                    values.set(name, {
                                        type: "Content",
                                        content: contentState.getDoc(),
                                    });
                                    break;
                                }
                                default:
                                    throw exhaustive(propertySchema);
                            }
                        }

                        const navigateUrl = await onDuplicate(values);
                        await navigate(navigateUrl);
                    }}
                >
                    Create
                </Button>
            </Box>
        ),
    });

    return (
        <Box
            ref={useMergedRefs<HTMLDivElement>(
                scrollViewRef,
                useScrollbar({insetTop: scrollbarInsetTop}),
            )}
            flexGrow="1"
            width="full"
            height="full"
            position="relative"
            zIndex="0"
            overflowX="hidden"
            overflowY="auto"
        >
            <OverlayScopeContextProvider>
                <Box
                    position="relative"
                    paddingY="safe-area-inset"
                    width="full"
                    maxWidth={peekNarrowLayoutWidth}
                    marginX="auto"
                >
                    {navigationBar}
                    <Box height={navigationBarHeight} />
                    <Box
                        display="flex"
                        flexDirection="column"
                        gap={channelCreatorGap}
                        paddingTop={channelCreatorMarginTop}
                        paddingBottom={screenPaddingX}
                        paddingX={screenPaddingX}
                    >
                        {mapIterable(variableSchema, ([name, propertySchema], index) => (
                            <ContentDuplicationViewProperty
                                ref={index === 0 ? firstPropertyRef : null}
                                key={name}
                                name={name}
                                propertySchema={propertySchema}
                                textValues={textValues}
                                setTextValues={setTextValues}
                                contentStates={contentStates}
                                setContentStates={setContentStates}
                                onDuplicate={() => assertExists(buttonRef.current).press()}
                            />
                        ))}
                    </Box>
                </Box>
            </OverlayScopeContextProvider>
        </Box>
    );
}

type ContentDuplicationViewPropertyRef = {
    focus: () => void;
};

function ContentDuplicationViewProperty({
    ref,
    name,
    propertySchema,
    textValues,
    setTextValues,
    contentStates,
    setContentStates,
    onDuplicate,
}: {
    ref: Ref<ContentDuplicationViewPropertyRef>;
    name: string;
    propertySchema: ContentDuplicationVariableSchemaProperty;
    textValues: ReadonlyMap<string, string>;
    setTextValues: Dispatch<SetStateAction<ReadonlyMap<string, string>>>;
    contentStates: ReadonlyMap<string, ContentEditorState<MessageContentWithReferences>>;
    setContentStates: Dispatch<
        SetStateAction<ReadonlyMap<string, ContentEditorState<MessageContentWithReferences>>>
    >;
    onDuplicate: () => void;
}) {
    switch (propertySchema.type) {
        case "Text": {
            return (
                <ContentDuplicationViewTextProperty
                    ref={ref}
                    name={name}
                    propertySchema={propertySchema}
                    textValue={textValues.get(name) ?? ""}
                    onTextValueChange={textValue => {
                        setTextValues(oldTextValues => {
                            const newTextValues = new Map(oldTextValues);
                            newTextValues.set(name, textValue);
                            return newTextValues;
                        });
                    }}
                    onDuplicate={onDuplicate}
                />
            );
        }
        case "Content": {
            return (
                <ContentDuplicationViewContentProperty
                    ref={ref}
                    name={name}
                    propertySchema={propertySchema}
                    contentState={assertExists(contentStates.get(name))}
                    onContentStateChange={contentState => {
                        setContentStates(oldContentStates => {
                            const newContentStates = new Map(oldContentStates);
                            newContentStates.set(name, contentState);
                            return newContentStates;
                        });
                    }}
                    onDuplicate={onDuplicate}
                />
            );
        }
        default:
            throw exhaustive(propertySchema);
    }
}

const ContentDuplicationViewTextProperty = memo(function ContentDuplicationViewTextProperty({
    ref,
    name,
    propertySchema,
    textValue,
    onTextValueChange,
    onDuplicate,
}: {
    ref: Ref<ContentDuplicationViewPropertyRef>;
    name: string;
    propertySchema: ContentDuplicationVariableSchemaTextProperty;
    textValue: string;
    onTextValueChange: (textValue: string) => void;
    onDuplicate: () => void;
}) {
    const inputRef = useRef<HTMLInputElement>(null);

    useImperativeHandle(ref, () => ({
        focus: () => {
            assertExists(inputRef.current).focus();
        },
    }));

    const {isBold, isItalic, isStrike, isCode} = useMemo(() => {
        let isBold = false;
        let isItalic = false;
        let isStrike = false;
        let isCode = false;

        for (const mark of propertySchema.marks) {
            const markTypeName = mark.type;

            switch (markTypeName) {
                case "bold":
                    isBold = true;
                    break;
                case "italic":
                    isItalic = true;
                    break;
                case "strike":
                    isStrike = true;
                    break;
                case "code":
                    isCode = true;
                    break;
                case "highlight":
                    // We don't currently render highlight colors in the property text input since
                    // getting the CSS for that right is a little tricky.
                    break;
                default:
                    throw exhaustive(markTypeName);
            }
        }

        return {isBold, isItalic, isStrike, isCode};
    }, [propertySchema.marks]);

    return (
        <TextInput
            ref={inputRef}
            fontSize="100"
            label={name}
            placeholder="…"
            // Disable autocomplete, doesn't make sense for this input.
            autoComplete="off"
            fontStyle={
                // Don't render the actual font style until the user starts typing. Monospace
                // code style for the ellipsis character looks funny.
                textValue.length === 0
                    ? "normal"
                    : isCode && isBold
                      ? "code-extra-bold"
                      : isBold
                        ? "extra-bold"
                        : isCode
                          ? "code"
                          : "normal"
            }
            isFontItalic={isItalic}
            hasFontStrikeDecoration={isStrike}
            value={textValue}
            onChange={onTextValueChange}
            onModEnter={onDuplicate}
        />
    );
});

const ContentDuplicationViewContentProperty = memo(function ContentDuplicationViewContentProperty({
    ref,
    name,
    contentState,
    onContentStateChange,
    onDuplicate,
}: {
    ref: Ref<ContentDuplicationViewPropertyRef>;
    name: string;
    propertySchema: ContentDuplicationVariableSchemaContentProperty;
    contentState: ContentEditorState<MessageContentWithReferences>;
    onContentStateChange: (contentState: ContentEditorState<MessageContentWithReferences>) => void;
    onDuplicate: () => void;
}) {
    const spacingScale = useSpacingScale();
    const labelId = useId();

    const editorRef = useRef<ContentEditorRef<MessageContentWithReferences>>(null);

    useImperativeHandle(ref, () => ({
        focus: () => {
            assertExists(editorRef.current).focus();
        },
    }));

    return (
        <Box>
            <label
                id={labelId}
                className={sprinkles({
                    // `display: block; width: fit-content` is important here! As `inline-block`
                    // there's some weird additional vertical space underneath the label.
                    display: "block",
                    width: "fit-content",
                    maxWidth: "full",
                    fontSize: "75",
                    fontStyle: "truncate-semi-bold",
                    paddingBottom: "1.5",
                })}
                onClick={() => {
                    assertExists(editorRef.current).focus();
                }}
            >
                {name}
            </label>
            <FocusRing offset="border" isVisibleWhenFocusWithin>
                <Box borderRadius="1" boxShadow="elevation-5-with-grey-10-border">
                    <ContentEditor
                        ref={editorRef}
                        aria-labelledby={labelId}
                        state={contentState}
                        onChange={onContentStateChange}
                        onModEnterKeyDown={onDuplicate}
                        className={sprinkles({
                            paddingX: channelCreatorDescriptionFieldPaddingX,
                            paddingY: channelCreatorDescriptionFieldPaddingY,
                        })}
                        style={{
                            minHeight: channelCreatorDescriptionFieldMinHeightPx[spacingScale],
                        }}
                        placeholder="…"
                        // Always in editing mode. User won't be reading while in the modal.
                        withoutMobileDualModality={true}
                    />
                </Box>
            </FocusRing>
        </Box>
    );
});
