import {CaretDown, Plus} from "phosphor-react";
import {useCallback, useRef} from "react";
import {useButton} from "react-aria";
import {Box} from "~/client/design/box";
import {Button, buttonPressedOverlayOpacity} from "~/client/design/button";
import {FocusRing} from "~/client/design/focus_ring";
import {MenuAction, MenuButton} from "~/client/design/menu_button";
import {
    PrettyAbsoluteDate,
    usePrettyAbsoluteDateFormatter,
} from "~/client/design/pretty_absolute_date";
import {useEvent} from "~/client/helpers/lifecycle/use_event";
import {LocalTasksAction, LocalTasksState} from "~/client/tasks/demo_2/local_tasks_state";
import {spacing} from "~/shared/design/spacing";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable";
import {sprinkles} from "~/shared/styles/styles";

export function TaskNotepadViewPaginator({
    state,
    dispatch,
    notepadPageId,
    onNotepadPageIdChange: _onNotepadPageIdChange,
}: {
    state: LocalTasksState;
    dispatch: (action: LocalTasksAction) => void;
    notepadPageId: number;
    onNotepadPageIdChange: (notepadPageId: number) => void;
}) {
    const menuButtonRef = useRef<HTMLButtonElement>(null);
    const {buttonProps: menuButtonProps, isPressed: isMenuButtonPressed} = useButton(
        {},
        menuButtonRef,
    );

    const formatDateWithoutTime = usePrettyAbsoluteDateFormatter({
        shouldIncludeWeekday: true,
        shouldExcludeTime: true,
    });

    const formatDateWithTimeWithoutSeconds = usePrettyAbsoluteDateFormatter({
        shouldIncludeWeekday: true,
    });

    const formatDateWithTimeWithSeconds = usePrettyAbsoluteDateFormatter({
        shouldIncludeWeekday: true,
        shouldIncludeSeconds: true,
    });

    const onNotepadPageIdChange = useEvent(_onNotepadPageIdChange);

    return (
        <Box display="flex" alignItems="center" gap="4">
            <Box color="grey-50" fontSize="50">
                Page created{" "}
                <PrettyAbsoluteDate
                    date={new Date(notepadPageId * 1000)}
                    tooltipPlacement="bottom-end"
                    shouldExcludeTime={true}
                />
            </Box>
            <Box display="flex">
                <Button
                    variant="neutral"
                    icon={<Plus />}
                    height="6"
                    paddingX="2"
                    borderRightRadius="none"
                    onPress={() => {
                        const newNotepadPageId = Math.max(
                            (state.database.getLatestNotepadPageId() ?? -1) + 1,
                            Math.floor(Date.now() / 1000),
                        );
                        dispatch({type: "CreateNotepadPage", notepadPageId: newNotepadPageId});

                        onNotepadPageIdChange(newNotepadPageId);
                    }}
                >
                    Fresh page
                </Button>
                <MenuButton
                    width="48"
                    maxHeight="64"
                    actions={useCallback(() => {
                        return Array.from(
                            mapIterable(
                                iterateWithAdjacents(
                                    mapIterable(
                                        iterateWithAdjacents(
                                            mapIterable(
                                                state.database.getNotepadPageIds(),
                                                notepadPageId => {
                                                    const date = new Date(notepadPageId * 1000);
                                                    const dateString = formatDateWithoutTime(date);
                                                    return {id: notepadPageId, date, dateString};
                                                },
                                            ),
                                        ),
                                        // If page was in the same day as adjacent pages then add minutes to the page
                                        // date string.
                                        ([previousNotepadPage, notepadPage, nextNotepadPage]) => {
                                            if (
                                                notepadPage.dateString ===
                                                previousNotepadPage?.dateString
                                            ) {
                                                return {
                                                    ...notepadPage,
                                                    dateString: formatDateWithTimeWithoutSeconds(
                                                        notepadPage.date,
                                                    ),
                                                };
                                            }
                                            if (
                                                notepadPage.dateString ===
                                                nextNotepadPage?.dateString
                                            ) {
                                                return {
                                                    ...notepadPage,
                                                    dateString: formatDateWithTimeWithoutSeconds(
                                                        notepadPage.date,
                                                    ),
                                                };
                                            }
                                            return notepadPage;
                                        },
                                    ),
                                ),
                                // If page was in the same minute as adjacent pages then add seconds to the page
                                // date string.
                                ([previousNotepadPage, notepadPage, nextNotepadPage]) => {
                                    if (
                                        notepadPage.dateString === previousNotepadPage?.dateString
                                    ) {
                                        return {
                                            ...notepadPage,
                                            dateString: formatDateWithTimeWithSeconds(
                                                notepadPage.date,
                                            ),
                                        };
                                    }
                                    if (notepadPage.dateString === nextNotepadPage?.dateString) {
                                        return {
                                            ...notepadPage,
                                            dateString: formatDateWithTimeWithSeconds(
                                                notepadPage.date,
                                            ),
                                        };
                                    }
                                    return notepadPage;
                                },
                            ),
                            (notepadPage): MenuAction => ({
                                label: notepadPage.dateString,
                                isSelected: notepadPageId === notepadPage.id,
                                onPress: () => onNotepadPageIdChange(notepadPage.id),
                            }),
                        );
                    }, [
                        formatDateWithTimeWithSeconds,
                        formatDateWithTimeWithoutSeconds,
                        formatDateWithoutTime,
                        notepadPageId,
                        onNotepadPageIdChange,
                        state.database,
                    ])}
                >
                    <FocusRing>
                        <button
                            {...menuButtonProps}
                            ref={menuButtonRef}
                            className={sprinkles({
                                display: "block",
                                height: "6",
                                paddingX: "1",
                                backgroundColor: {light: "grey-80", dark: "grey-90"},
                                color: "grey-0",
                                borderRightRadius: "base",
                                overflow: "hidden",
                                position: "relative",
                            })}
                            style={{
                                marginLeft: 1,
                            }}
                        >
                            {isMenuButtonPressed && (
                                <span
                                    className={sprinkles({
                                        position: "absolute",
                                        inset: "0",
                                        backgroundColor: "grey-dark",
                                        pointerEvents: "none",
                                    })}
                                    style={{opacity: buttonPressedOverlayOpacity}}
                                />
                            )}
                            <CaretDown size={spacing["3"]} weight="bold" />
                        </button>
                    </FocusRing>
                </MenuButton>
            </Box>
        </Box>
    );
}

/**
 * Transform an iterable into one that yields not only the current item but the
 * items before and after the current item.
 */
function iterateWithAdjacents<Value>(
    iterable: Iterable<Value>,
): Iterable<[Value | undefined, Value, Value | undefined]> {
    return {
        [Symbol.iterator]: function* () {
            let lastValue: Value | undefined;
            let value: Value | undefined;

            for (const nextValue of iterable) {
                if (value !== undefined) yield [lastValue, value, nextValue];

                lastValue = value;
                value = nextValue;
            }

            if (value !== undefined) yield [lastValue, value, undefined];
        },
    };
}
