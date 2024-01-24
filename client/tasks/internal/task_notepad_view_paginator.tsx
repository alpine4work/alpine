import {CaretDown, Plus} from "phosphor-react";
import {useCallback} from "react";
import {useAppContext} from "~/client/context/app_context.js";
import {Box} from "~/client/design/box.js";
import {Button} from "~/client/design/button.js";
import {MenuAction, MenuButton} from "~/client/design/menu_button.js";
import {usePrettyAbsoluteDateFormatter} from "~/client/design/pretty_absolute_date.js";
import {useEvent} from "~/client/helpers/lifecycle/use_event.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {TaskClientStore} from "~/client/tasks/task_client_store.js";
import {getSynchronizedSystemClock} from "~/client/tracer/synchronized_system_clock.js";
import {Lazy} from "~/shared/helpers/control/lazy.js";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.js";
import {commitTaskActionTransaction} from "~/shared/rpc/tasks_rpc_definitions.js";
import {TaskNotepadPageId, generateTaskNotepadPageId} from "~/shared/tasks/task_notepad_page_id.js";

export function TaskNotepadViewPaginator({
    store,
    allNotepadPageIds,
    notepadPageId,
    onNotepadPageIdCreate,
    onNotepadPageIdSelect,
}: {
    store: TaskClientStore;
    allNotepadPageIds: Lazy<Iterable<TaskNotepadPageId>>;
    notepadPageId: TaskNotepadPageId;
    onNotepadPageIdCreate: (notepadPageId: TaskNotepadPageId) => Promise<void>;
    onNotepadPageIdSelect: (notepadPageId: TaskNotepadPageId) => Promise<void>;
}) {
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    onNotepadPageIdSelect = useEvent(onNotepadPageIdSelect);

    const context = useAppContext();
    const {space, currentAccount} = useSpaceContext();

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

    return (
        <Box display="flex" alignItems="center" gap="3">
            <Button
                variant="neutral"
                icon={<Plus />}
                height="6"
                paddingX="2"
                pressErrorTitle="Couldn’t create notepad page"
                onPress={async () => {
                    const synchronizedSystemClock = await getSynchronizedSystemClock();

                    const newNotepadPageId = generateTaskNotepadPageId(synchronizedSystemClock);

                    // You may notice that we're directly calling `commitTaskActionTransaction()`
                    // instead of calling `store.commitTaskActionTransaction()`! This is because we
                    // don't try keeping task notepad pages up-to-date in realtime. So we'd rather
                    // do the pending/error state here instead of using the `TaskClientStore`
                    // optimistic update/rollback machinery.
                    await commitTaskActionTransaction(context, {
                        clientId: null,
                        spaceId: space.id,
                        actions: [
                            {
                                type: "UpdateNotepadPage",
                                time: store.clock.now(),
                                accountId: currentAccount.id,
                                notepadPageId: newNotepadPageId,
                                notepadPageAction: {type: "Create"},
                            },
                        ],
                    });

                    await onNotepadPageIdCreate(newNotepadPageId);
                }}
            >
                Fresh page
            </Button>
            <MenuButton
                size="lg"
                maxHeight="64"
                placement="bottom-end"
                actions={useCallback(() => {
                    return Array.from(
                        mapIterable(
                            iterateWithAdjacents(
                                mapIterable(
                                    iterateWithAdjacents(
                                        mapIterable(allNotepadPageIds.get(), notepadPageId => {
                                            const date = new Date(notepadPageId);
                                            const dateString = formatDateWithoutTime(date);
                                            return {id: notepadPageId, date, dateString};
                                        }),
                                    ),
                                    // If page was in the same day as adjacent pages then add minutes to the page
                                    // date string.
                                    ([previousNotepadPage, notepadPage, nextNotepadPage]) => {
                                        if (
                                            notepadPage.dateString ===
                                                previousNotepadPage?.dateString ||
                                            notepadPage.dateString === nextNotepadPage?.dateString
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
                                    notepadPage.dateString === previousNotepadPage?.dateString ||
                                    notepadPage.dateString === nextNotepadPage?.dateString
                                ) {
                                    return {
                                        ...notepadPage,
                                        dateString: formatDateWithTimeWithSeconds(notepadPage.date),
                                    };
                                }
                                return notepadPage;
                            },
                        ),
                        (notepadPage): MenuAction => ({
                            label: notepadPage.dateString,
                            isSelected: notepadPageId === notepadPage.id,
                            pressErrorTitle: "Couldn’t open notepad page",
                            onPress: async () => {
                                await onNotepadPageIdSelect(notepadPage.id);
                            },
                        }),
                    ).reverse();
                }, [
                    allNotepadPageIds,
                    formatDateWithTimeWithSeconds,
                    formatDateWithTimeWithoutSeconds,
                    formatDateWithoutTime,
                    notepadPageId,
                    onNotepadPageIdSelect,
                ])}
            >
                <Button
                    variant="quieter"
                    height="6"
                    paddingX="2"
                    icon={<CaretDown />}
                    iconPlacement="end"
                >
                    Pages
                </Button>
            </MenuButton>
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
