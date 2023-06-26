import Fuse from "fuse.js";
import GraphemeSplitter from "grapheme-splitter";
import {Fragment, useMemo, useState} from "react";
import {Box} from "~/client/design/box.js";
import {PrettyNumber} from "~/client/design/pretty_number.js";
import {TaskCollectionOption} from "~/client/tasks/demo_2/internal/task_collection_option.js";
import {
    TaskQueryFilterEditorMultiSelectComboBox,
    TaskQueryFilterEditorMultiSelectComboBoxItem,
} from "~/client/tasks/demo_2/internal/task_query_filter_editor_multi_select_combo_box.js";
import {TaskQueryFilterOperatorEditor} from "~/client/tasks/demo_2/internal/task_query_filter_operator_editor.js";
import {LocalTasksState} from "~/client/tasks/demo_2/local_tasks_state.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {iterableFindIndex} from "~/shared/helpers/iterable/iterable_find_index.js";
import {sliceIterable} from "~/shared/helpers/iterable/slice_iterable.js";
import {LocalTaskCollectionId} from "~/shared/id/types/id_types.js";
import {inputPlaceholderStyles} from "~/shared/styles/styles.js";
import {TaskQueryCollectionsFilter} from "~/shared/tasks/task_query_filter.js";

export function TaskQueryCollectionsFilterOperationEditor({
    state,
    filter,
    onFilterChange,
}: {
    state: LocalTasksState;
    filter: TaskQueryCollectionsFilter;
    onFilterChange: (filter: TaskQueryCollectionsFilter) => void;
}) {
    // Simplify operator label if there is just one collection and the operators do
    // the same thing.
    const includesOneOfOperatorLabel =
        filter.operation.type !== "IsEmpty" && filter.operation.collectionIds.size <= 1
            ? "has"
            : "has any of";
    const includesAllOfOperatorLabel =
        filter.operation.type !== "IsEmpty" && filter.operation.collectionIds.size <= 1
            ? "has"
            : "has all of";

    const excludesAllOfOperatorLabel = "has none of";
    const isEmptyOperatorLabel = "is empty";

    return (
        <>
            <TaskQueryFilterOperatorEditor
                operatorLabel={
                    filter.operation.type === "IncludesOneOf"
                        ? includesOneOfOperatorLabel
                        : filter.operation.type === "IncludesAllOf"
                        ? includesAllOfOperatorLabel
                        : filter.operation.type === "ExcludesAllOf"
                        ? excludesAllOfOperatorLabel
                        : isEmptyOperatorLabel
                }
                allOperators={[
                    ...(filter.operation.type !== "IsEmpty" &&
                    filter.operation.collectionIds.size <= 1
                        ? [
                              {
                                  label: includesAllOfOperatorLabel,
                                  isSelected:
                                      filter.operation.type === "IncludesOneOf" ||
                                      filter.operation.type === "IncludesAllOf",
                                  onPress: () => {
                                      onFilterChange({
                                          type: "Collections",
                                          operation: {
                                              type:
                                                  filter.operation.type === "IncludesOneOf"
                                                      ? "IncludesOneOf"
                                                      : "IncludesAllOf",
                                              collectionIds:
                                                  filter.operation.type !== "IsEmpty"
                                                      ? filter.operation.collectionIds
                                                      : new Set(),
                                          },
                                      });
                                  },
                              },
                          ]
                        : [
                              {
                                  label: includesAllOfOperatorLabel,
                                  isSelected: filter.operation.type === "IncludesAllOf",
                                  onPress: () => {
                                      onFilterChange({
                                          type: "Collections",
                                          operation: {
                                              type: "IncludesAllOf",
                                              collectionIds:
                                                  filter.operation.type !== "IsEmpty"
                                                      ? filter.operation.collectionIds
                                                      : new Set(),
                                          },
                                      });
                                  },
                              },
                              {
                                  label: includesOneOfOperatorLabel,
                                  isSelected: filter.operation.type === "IncludesOneOf",
                                  onPress: () => {
                                      onFilterChange({
                                          type: "Collections",
                                          operation: {
                                              type: "IncludesOneOf",
                                              collectionIds:
                                                  filter.operation.type !== "IsEmpty"
                                                      ? filter.operation.collectionIds
                                                      : new Set(),
                                          },
                                      });
                                  },
                              },
                          ]),
                    {
                        label: excludesAllOfOperatorLabel,
                        isSelected: filter.operation.type === "ExcludesAllOf",
                        onPress: () => {
                            onFilterChange({
                                type: "Collections",
                                operation: {
                                    type: "ExcludesAllOf",
                                    collectionIds:
                                        filter.operation.type !== "IsEmpty"
                                            ? filter.operation.collectionIds
                                            : new Set(),
                                },
                            });
                        },
                    },
                    {
                        label: isEmptyOperatorLabel,
                        isSelected: filter.operation.type === "IsEmpty",
                        onPress: () => {
                            onFilterChange({
                                type: "Collections",
                                operation: {type: "IsEmpty"},
                            });
                        },
                    },
                ]}
            />
            {filter.operation.type !== "IsEmpty" && (
                <TaskQueryFilterEditorMultiSelectComboBox
                    inputLabel="Collection"
                    preview={
                        <TaskQueryCollectionsFilterOperationEditorPreview
                            state={state}
                            conjunction={filter.operation.type === "IncludesOneOf" ? "or" : "and"}
                            collectionIds={filter.operation.collectionIds}
                        />
                    }
                    selectedKeys={filter.operation.collectionIds}
                    onSelectedKeysChange={collectionIds => {
                        onFilterChange({
                            type: "Collections",
                            operation: {
                                type: filter.operation.type,
                                collectionIds,
                            },
                        });
                    }}
                    useSearchedItems={searchInputValue => {
                        assert(filter.operation.type !== "IsEmpty");

                        // The `useSearchedItems()` callback follows the rules of hooks.
                        // eslint-disable-next-line react-hooks/rules-of-hooks
                        return useTaskQueryCollectionsFilterOperationEditorSearchedItems({
                            searchInputValue,
                            state,
                            collectionIds: filter.operation.collectionIds,
                        });
                    }}
                    optionCheckboxMarginTop="0.5"
                />
            )}
        </>
    );
}

function TaskQueryCollectionsFilterOperationEditorPreview({
    state,
    conjunction,
    collectionIds,
}: {
    state: LocalTasksState;
    conjunction: "or" | "and";
    collectionIds: ReadonlySet<LocalTaskCollectionId>;
}) {
    const previewCollections = Array.from(sliceIterable(collectionIds, 0, 2), collectionId => {
        const collection = state.database.getTaskCollection(collectionId);
        const collectionNameGraphemes = new GraphemeSplitter().splitGraphemes(collection.name);
        const collectionNameGraphemeLimit = 30;

        return (
            <Fragment key={collectionId}>
                <Box
                    width="1.5"
                    height="1.5"
                    borderRadius="full"
                    backgroundColor={`${collection.color}-50-const`}
                />
                <Box paddingLeft="1">
                    {collectionNameGraphemes.length > collectionNameGraphemeLimit
                        ? `“${collectionNameGraphemes
                              .slice(0, collectionNameGraphemeLimit)
                              .join("")}…”`
                        : collection.name}
                </Box>
            </Fragment>
        );
    });

    if (collectionIds.size === 0) {
        return <Box style={inputPlaceholderStyles}>any collection</Box>;
    } else if (collectionIds.size === 1) {
        return <>{previewCollections[0]}</>;
    } else if (collectionIds.size === 2) {
        return (
            <>
                {previewCollections[0]}
                <Box paddingLeft="1" paddingRight="1.5" color="grey-60">
                    {conjunction}
                </Box>
                {previewCollections[1]}
            </>
        );
    } else {
        return (
            <>
                {previewCollections[0]}
                <Box color="grey-60" paddingRight="1.5">
                    ,
                </Box>
                {previewCollections[1]}
                <Box color="grey-60" paddingRight="1">
                    , {conjunction}
                </Box>
                <PrettyNumber number={collectionIds.size - 2} label="other" />
            </>
        );
    }
}

function useTaskQueryCollectionsFilterOperationEditorSearchedItems({
    searchInputValue,
    state,
    collectionIds,
}: {
    searchInputValue: string;
    state: LocalTasksState;
    collectionIds: ReadonlySet<LocalTaskCollectionId>;
}) {
    const [initialCollectionIds] = useState(() => collectionIds);

    const collections = useMemo(() => {
        const collections = state.database.getAllTaskCollections();

        collections.sort((collection1, collection2) => {
            // Sort the selected collections when the listbox was opened first in our
            // items list.
            const isInitialCollection1 = initialCollectionIds.has(collection1.id);
            const isInitialCollection2 = initialCollectionIds.has(collection2.id);

            if (isInitialCollection1 && !isInitialCollection2) return -1;
            if (isInitialCollection2 && !isInitialCollection1) return 1;

            if (isInitialCollection1 && isInitialCollection2) {
                return (
                    iterableFindIndex(
                        initialCollectionIds,
                        collectionId => collectionId === collection1.id,
                    ) -
                    iterableFindIndex(
                        initialCollectionIds,
                        collectionId => collectionId === collection2.id,
                    )
                );
            }

            return collection1.name.localeCompare(collection2.name);
        });

        return collections;
    }, [initialCollectionIds, state.database]);

    const allItems: Array<TaskQueryFilterEditorMultiSelectComboBoxItem<LocalTaskCollectionId>> =
        useMemo(
            () =>
                collections.map(collection => ({
                    key: collection.id,
                    textValue: collection.name,
                    node: <TaskCollectionOption collection={collection} />,
                })),
            [collections],
        );

    const itemsSearchIndex = useMemo(() => new Fuse(allItems, {keys: ["textValue"]}), [allItems]);

    const searchedItems = useMemo(
        () =>
            searchInputValue === ""
                ? allItems
                : itemsSearchIndex.search(searchInputValue).map(({item}) => item),
        [allItems, itemsSearchIndex, searchInputValue],
    );

    return {isLoading: false as const, searchedItems};
}
