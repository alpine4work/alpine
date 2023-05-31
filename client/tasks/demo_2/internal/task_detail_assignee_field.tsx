import {isFocusVisible} from "@react-aria/interactions";
import {Node} from "@react-types/shared";
import Fuse from "fuse.js";
import {Check, MagnifyingGlass, User} from "phosphor-react";
import {RefObject, cloneElement, isValidElement, useMemo, useRef, useState} from "react";
import {
    AriaListBoxOptions,
    mergeProps,
    useComboBox,
    useHover,
    useListBox,
    useOption,
} from "react-aria";
import {ComboBoxState, ComboBoxStateOptions, Item, useComboBoxState} from "react-stately";
import {AccountAvatar} from "~/client/accounts/account_avatar";
import {Box} from "~/client/design/box";
import {FocusRing} from "~/client/design/focus_ring";
import {useSpacingPx} from "~/client/design/helpers/use_spacing_px";
import {OverlayAnimated} from "~/client/design/overlay_animated";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning";
import {useExpensivelyLoadAllSpaceAccounts} from "~/client/spaces/use_expensively_load_all_space_accounts";
import {AccountModel} from "~/shared/accounts/account_model";
import {addRemLengths, parseRemLengthNumber, spacing} from "~/shared/design/spacing";
import {emptyArray} from "~/shared/helpers/array/empty_array";
import {assert} from "~/shared/helpers/control/assert";
import {assertExists} from "~/shared/helpers/control/assert_exists";
import {exhaustive} from "~/shared/helpers/control/exhaustive";
import {assertId} from "~/shared/id/id";
import {AccountId} from "~/shared/id/types/id_types";
import {
    colorSchemeVars,
    inputPlaceholderStyles,
    sprinkles,
    tasksStyles,
} from "~/shared/styles/styles";

const nullAssigneeLabel = "Unassigned";

type TaskDetailAssigneeFieldItem =
    | {
          readonly type: "Account";
          readonly key: `Account:${AccountId}`;
          readonly account: AccountModel;
      }
    | {
          readonly type: "Null";
          readonly key: "Null";
          readonly account?: undefined;
      };

type TaskDetailAssigneeFieldInputState =
    | {
          readonly type: "Selection";
          readonly disableAnimationOut: boolean;
      }
    | {
          readonly type: "Typing";
          readonly value: string;
          readonly hasChanged: boolean;
      };

export function TaskDetailAssigneeField({
    assigneeAccount,
    onAssigneeAccountChange,
    "aria-labelledby": ariaLabelledBy,
}: {
    assigneeAccount: AccountModel | null;
    onAssigneeAccountChange: (assigneeAccount: AccountModel | null) => void;
    "aria-labelledby": string;
}) {
    const [inputState, setInputState] = useState<TaskDetailAssigneeFieldInputState>({
        type: "Selection",
        disableAnimationOut: false,
    });

    const inputValue =
        inputState.type === "Selection" ? assigneeAccount?.name ?? "" : inputState.value;

    const allUnsortedAccounts = useExpensivelyLoadAllSpaceAccounts() ?? emptyArray;

    const accountById = useMemo(() => {
        const accountById = new Map<AccountId, AccountModel>();
        for (const account of allUnsortedAccounts) accountById.set(account.id, account);
        return accountById;
    }, [allUnsortedAccounts]);

    const allItems = useMemo(() => {
        const allItems: Array<TaskDetailAssigneeFieldItem> = allUnsortedAccounts.map(account => ({
            type: "Account",
            key: `Account:${account.id}`,
            account,
        }));

        allItems.push({type: "Null", key: "Null"});

        allItems.sort((item1, item2) =>
            item1.type === "Null"
                ? -1
                : item2.type === "Null"
                ? 1
                : item1.account.name.localeCompare(item2.account.name),
        );

        return allItems;
    }, [allUnsortedAccounts]);

    const itemsSearchIndex = useMemo(
        () =>
            new Fuse(allItems, {
                keys: [{name: "name", getFn: item => item.account?.name ?? nullAssigneeLabel}],
            }),
        [allItems],
    );

    const searchedItems = useMemo(
        () =>
            inputValue === "" || inputState.type === "Selection" || !inputState.hasChanged
                ? allItems
                : itemsSearchIndex.search(inputValue).map(({item}) => item),

        [allItems, inputState, inputValue, itemsSearchIndex],
    );

    const selectedKey = assigneeAccount ? `Account:${assigneeAccount.id}` : "Null";

    const comboBoxProps: ComboBoxStateOptions<TaskDetailAssigneeFieldItem> = {
        menuTrigger: "focus",
        // Don't close when there are no items.
        allowsEmptyCollection: true,

        inputValue,
        onInputChange: inputValue => {
            setInputState({type: "Typing", value: inputValue, hasChanged: true});
        },

        onFocus: () => {
            // Select all text on focus.
            assertExists(inputRef.current).select();

            // When focused, switch to a typing state.
            setInputState(inputState => {
                if (inputState.type === "Typing") return inputState;
                return {type: "Typing", value: inputValue, hasChanged: false};
            });
        },

        onBlur: () => {
            // When unfocused, switch back to a selection state discarding any typed value.
            setInputState(inputState => {
                if (inputState.type === "Selection") return inputState;
                return {type: "Selection", disableAnimationOut: false};
            });
        },

        items: searchedItems,
        children: item => (
            <Item textValue={item.account?.name ?? nullAssigneeLabel}>
                <TaskDetailAssigneeFieldListBoxOptionItem item={item} />
            </Item>
        ),

        selectedKey,
        onSelectionChange: key => {
            assert(typeof key === "string");

            if (key === "Null") {
                if (assigneeAccount) {
                    onAssigneeAccountChange(null);
                }
            } else {
                const accountId = assertId<AccountId>(key.slice("Account:".length));
                const account = assertExists(accountById.get(accountId));
                if (assigneeAccount?.id !== accountId) {
                    onAssigneeAccountChange(account);
                }
            }

            setInputState(inputState => {
                if (inputState.type === "Selection") return inputState;
                return {type: "Selection", disableAnimationOut: true};
            });

            assertExists(inputRef.current).blur();
        },
    };

    const comboBoxState = useComboBoxState(comboBoxProps);

    const inputRef = useRef<HTMLInputElement>(null);
    const popoverRef = useRef<HTMLDivElement>(null);
    const listBoxRef = useRef<HTMLUListElement>(null);

    const {inputProps, listBoxProps} = useComboBox(
        {
            ...comboBoxProps,
            inputRef,
            popoverRef,
            listBoxRef,
            "aria-labelledby": ariaLabelledBy,
        },
        comboBoxState,
    );

    return (
        <Box height="4" marginTop="-0.5" marginLeft="-0.5">
            <OverlayAnimated
                isVisible={comboBoxState.isOpen}
                offset="2"
                offsetAlong={`-${parseRemLengthNumber(
                    addRemLengths(spacing["4"], spacing["0.5"]),
                )}rem`}
                disableAnimationIn={true}
                disableAnimationOut={
                    inputState.type === "Selection" && inputState.disableAnimationOut
                }
                placement="bottom-start"
                overlay={
                    <Box ref={popoverRef} position="relative">
                        <TaskDetailAssigneeFieldListBox
                            comboBoxState={comboBoxState}
                            listBoxRef={listBoxRef}
                            listBoxProps={listBoxProps}
                            selectedKey={selectedKey}
                        />
                    </Box>
                }
            >
                <FocusRing isVisibleWhenFocusWithin>
                    <Box
                        maxWidth="full"
                        overflow="hidden"
                        display="inline-flex"
                        alignItems="center"
                        gap="1.5"
                        className={tasksStyles.textCursorNotInheritedClassName}
                        onClick={event => {
                            // If the backdrop of this element was clicked, focus our combobox input.
                            if (event.target === event.currentTarget) {
                                assertExists(inputRef.current).focus();
                            }
                        }}
                    >
                        <Box flexShrink="0" pointerEvents="none">
                            {assigneeAccount ? (
                                <AccountAvatar size="5" account={assigneeAccount} />
                            ) : (
                                <TaskDetailAssigneeFieldPlaceholderAvatar />
                            )}
                        </Box>
                        <Box
                            maxWidth="full"
                            overflow="hidden"
                            // The width of this element is determined by nested text boxes. The `<input>`
                            // then uses the parent width as its own width.
                            display="inline-block"
                        >
                            <Box height="0" opacity="0" pointerEvents="none" aria-hidden={true}>
                                {nullAssigneeLabel}
                            </Box>
                            <Box height="0" opacity="0" pointerEvents="none" aria-hidden={true}>
                                {inputValue}
                            </Box>
                            <input
                                {...inputProps}
                                ref={inputRef}
                                type="text"
                                className={sprinkles({
                                    display: "inline-block",
                                    width: "full",
                                    backgroundColor: "transparent",
                                })}
                                // By default `<input>` elements have a `min-width` determined by the `size`
                                // property. We want our `<input>`s `min-width` to be determined by our CSS
                                // so set it to a small value as not to matter.
                                // https://stackoverflow.com/questions/29470676/why-doesnt-the-input-element-respect-min-width
                                size={1}
                                placeholder={nullAssigneeLabel}
                            />
                        </Box>
                    </Box>
                </FocusRing>
            </OverlayAnimated>
        </Box>
    );
}

function TaskDetailAssigneeFieldPlaceholderAvatar() {
    const radius = useSpacingPx("5") / 2;
    const strokeWidth = 1;
    const viewBoxSize = radius * 2 + strokeWidth;
    const circumference = 2 * Math.PI * radius;
    const dashes = 7;
    const gapRatio = 0.5;

    return (
        <Box flexShrink="0" position="relative" width="5" height="5">
            <svg
                xmlns="http://www.w3.org/2000/svg"
                className={sprinkles({
                    width: "5",
                    height: "5",
                })}
                viewBox={`0 0 ${viewBoxSize} ${viewBoxSize}`}
            >
                <circle
                    cx={viewBoxSize / 2}
                    cy={viewBoxSize / 2}
                    r={radius}
                    fill="none"
                    stroke={inputPlaceholderStyles.color}
                    strokeWidth={strokeWidth}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeDasharray={`${(circumference / dashes) * (1 - gapRatio)} ${
                        (circumference / dashes) * gapRatio
                    }`}
                />
            </svg>
            <User
                size={spacing["3"]}
                color={inputPlaceholderStyles.color}
                className={sprinkles({
                    position: "absolute",
                    top: "1",
                    left: "1",
                })}
            />
        </Box>
    );
}

function TaskDetailAssigneeFieldListBox({
    comboBoxState,
    listBoxRef,
    listBoxProps: _listBoxProps,
    selectedKey,
}: {
    comboBoxState: ComboBoxState<TaskDetailAssigneeFieldItem>;
    listBoxRef: RefObject<HTMLUListElement>;
    listBoxProps: AriaListBoxOptions<TaskDetailAssigneeFieldItem>;
    selectedKey: string;
}) {
    const {listBoxProps} = useListBox(_listBoxProps, comboBoxState, listBoxRef);

    return (
        <ul
            {...listBoxProps}
            ref={listBoxRef}
            className={sprinkles({
                borderRadius: "md",
                padding: "1",
                marginX: "2",
                backgroundColor: {light: "grey-0", dark: "grey-5"},
                boxShadow: "elevation-20",
                width: "48",
                maxHeight: "64",
                overflowX: "hidden",
                overflowY: "scroll",
            })}
        >
            {comboBoxState.collection.size === 0 ? (
                <Box
                    paddingX="1.5"
                    paddingY="1.5"
                    display="flex"
                    alignItems="center"
                    gap="2"
                    color="grey-70"
                >
                    <Box padding="1">
                        <MagnifyingGlass size={spacing["4"]} />
                    </Box>
                    <Box>No results</Box>
                </Box>
            ) : (
                Array.from(comboBoxState.collection, item => (
                    <TaskDetailAssigneeFieldListBoxOption
                        key={item.key}
                        comboBoxState={comboBoxState}
                        item={item}
                        selectedKey={selectedKey}
                    />
                ))
            )}
        </ul>
    );
}

function TaskDetailAssigneeFieldListBoxOption({
    comboBoxState,
    item,
    selectedKey,
}: {
    comboBoxState: ComboBoxState<TaskDetailAssigneeFieldItem>;
    item: Node<TaskDetailAssigneeFieldItem>;
    selectedKey: string;
}) {
    const optionRef = useRef(null);
    const {isHovered, hoverProps} = useHover({});
    const {optionProps, isFocused, isPressed} = useOption(
        {key: item.key},
        comboBoxState,
        optionRef,
    );

    const [wasFocusVisibleWhenFocused, setWasFocusVisibleWhenFocused] = useState(false);
    useLayoutEffectWithoutServerSideWarning(() => {
        if (isFocused) setWasFocusVisibleWhenFocused(isFocusVisible());
    }, [isFocused]);

    assert(isValidElement(item.rendered));

    return (
        <FocusRing offset="0" isVisible={isFocused && wasFocusVisibleWhenFocused}>
            <li
                {...mergeProps(optionProps, hoverProps)}
                ref={optionRef}
                className={sprinkles({
                    width: "full",
                    paddingX: "1.5",
                    paddingY: "1.5",
                    borderRadius: "base",
                    color: "grey-text",
                    backgroundColor: isPressed
                        ? {light: "grey-10", dark: "grey-20"}
                        : isHovered
                        ? {light: "grey-5", dark: "grey-10"}
                        : undefined,
                })}
            >
                {cloneElement(item.rendered, {
                    isSelected: selectedKey === item.key,
                    isPressed,
                } as any)}
            </li>
        </FocusRing>
    );
}

function TaskDetailAssigneeFieldListBoxOptionItem({
    item,
    isSelected,
    isPressed,
}: {
    item: TaskDetailAssigneeFieldItem;
    isSelected?: boolean;
    isPressed?: boolean;
}) {
    assert(
        typeof isSelected === "boolean" && typeof isPressed === "boolean",
        "Expected to be rendered by <TaskDetailAssigneeFieldListBoxOption> which provides extra props",
    );

    switch (item.type) {
        case "Account": {
            return (
                <Box display="flex" alignItems="center" gap="1.5">
                    <AccountAvatar account={item.account} size="5" />
                    <Box flexGrow="1" fontStyle="truncate">
                        {item.account.name}
                    </Box>
                    {isSelected && (
                        <Box flexShrink="0" marginLeft="2">
                            <Check
                                size={spacing["3"]}
                                color={
                                    isPressed
                                        ? colorSchemeVars["grey-text"]
                                        : colorSchemeVars["grey-70"]
                                }
                            />
                        </Box>
                    )}
                </Box>
            );
        }
        case "Null": {
            return (
                <Box display="flex" alignItems="center" gap="1.5">
                    <TaskDetailAssigneeFieldPlaceholderAvatar />
                    <Box flexGrow="1" fontStyle="truncate">
                        {nullAssigneeLabel}
                    </Box>
                    {isSelected && (
                        <Box flexShrink="0" marginLeft="2">
                            <Check
                                size={spacing["3"]}
                                color={
                                    isPressed
                                        ? colorSchemeVars["grey-text"]
                                        : colorSchemeVars["grey-70"]
                                }
                            />
                        </Box>
                    )}
                </Box>
            );
        }
        default:
            throw exhaustive(item);
    }
}
