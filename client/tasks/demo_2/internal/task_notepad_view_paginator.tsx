import {CaretLeft, CaretRight, Plus} from "phosphor-react";
import {MutableRefObject, useRef, useState} from "react";
import {Box} from "~/client/design/box";
import {Button} from "~/client/design/button";
import {FocusRing} from "~/client/design/focus_ring";
import {IconButton} from "~/client/design/icon_button";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning";
import {spacing} from "~/shared/design/spacing";
import {assertExists} from "~/shared/helpers/control/assert_exists";
import {clamp} from "~/shared/helpers/number/clamp";
import {sprinkles} from "~/shared/styles/styles";

export function TaskNotepadViewPaginator({
    notepadPage,
    onNotepadPageChange,
    notepadPageCount,
    onNotepadPageCreate,
}: {
    notepadPage: number;
    onNotepadPageChange: (page: number) => void;
    notepadPageCount: number;
    onNotepadPageCreate: () => void;
}) {
    return (
        <Box display="flex" alignItems="center" gap="5">
            <Box display="flex" alignItems="center" gap="1">
                <IconButton
                    size="sm"
                    description="Previous page"
                    isDisabled={notepadPage <= 1}
                    onPress={() => onNotepadPageChange(notepadPage - 1)}
                >
                    <CaretLeft size={spacing["3"]} />
                </IconButton>
                <Box color="grey-70">
                    Page{" "}
                    <TaskNotepadPaginatorPageInput
                        notepadPage={notepadPage}
                        onNotepadPageChange={onNotepadPageChange}
                        notepadPageCount={notepadPageCount}
                    />{" "}
                    of{" "}
                    <Box display="inline" style={{fontVariantNumeric: "tabular-nums"}}>
                        {notepadPageCount}
                    </Box>
                </Box>
                <IconButton
                    size="sm"
                    description="Next page"
                    isDisabled={notepadPage >= notepadPageCount}
                    onPress={() => onNotepadPageChange(notepadPage + 1)}
                >
                    <CaretRight size={spacing["3"]} />
                </IconButton>
            </Box>
            <Button
                variant="neutral"
                icon={<Plus />}
                height="6"
                paddingX="2"
                onPress={onNotepadPageCreate}
            >
                New page
            </Button>
        </Box>
    );
}

function TaskNotepadPaginatorPageInput({
    notepadPage,
    onNotepadPageChange,
    notepadPageCount,
}: {
    notepadPage: number;
    onNotepadPageChange: (page: number) => void;
    notepadPageCount: number;
}) {
    const inputRef = useRef<HTMLInputElement>(null);

    const [state, setState] = useState<
        | {isFocused: false}
        | {
              isFocused: true;
              value: string;
              shouldSelectRef: MutableRefObject<boolean>;
          }
    >({
        isFocused: false,
    });

    const setStateAndUpdatePage = (newState: typeof state) => {
        setState(newState);

        // Update our local component state and the page number in the same
        // React commit. Instead of an effect which would be two commits.
        updatePage(newState);
    };

    const updatePage = (newState: typeof state) => {
        if (newState.isFocused && /\d+/.test(newState.value)) {
            const valueNumber = parseInt(newState.value, 10);
            const newNotepadPage = clamp(1, valueNumber, notepadPageCount);
            if (newNotepadPage !== notepadPage) {
                onNotepadPageChange(newNotepadPage);
            }
        }
    };

    useLayoutEffectWithoutServerSideWarning(() => {
        if (!state.isFocused || !state.shouldSelectRef.current) return;
        state.shouldSelectRef.current = false;

        assertExists(inputRef.current).select();
    }, [state]);

    const inputValue = state.isFocused ? state.value : String(notepadPage);
    const inputPlaceholder = String(notepadPageCount);

    return (
        <Box display="inline-block" position="relative">
            <FocusRing>
                <input
                    ref={inputRef}
                    className={sprinkles({
                        position: "absolute",
                        inset: "0",
                        display: "inline-block",
                        paddingX: "1",
                        paddingY: "0.5",
                        border: "grey-10",
                        borderRadius: "base",
                        backgroundColor: "grey-0",
                    })}
                    style={{fontVariantNumeric: "tabular-nums"}}
                    placeholder={inputPlaceholder}
                    value={inputValue}
                    onChange={event => {
                        if (!state.isFocused) return;

                        // Don't update the page while the user is typing. If they type "15" that means
                        // they first type "1". We don't want to navigate to "1".
                        setState({
                            isFocused: true,
                            value: event.currentTarget.value.replaceAll(/\D/g, ""),
                            shouldSelectRef: {current: false},
                        });
                    }}
                    onFocus={event => {
                        // Select everything in the input on focus.
                        event.currentTarget.select();

                        if (!state.isFocused) {
                            setState({
                                isFocused: true,
                                value: String(notepadPage),
                                shouldSelectRef: {current: false},
                            });
                        }
                    }}
                    onBlur={() => {
                        // When the user blurs, update our page if it's a valid page number. If the
                        // user types "15" we don't update the page as they type, only when they blur.
                        if (state.isFocused) {
                            updatePage(state);
                            setState({isFocused: false});
                        }
                    }}
                    onKeyDown={event => {
                        switch (event.key) {
                            case "Enter": {
                                event.preventDefault();
                                event.stopPropagation();

                                // If the user hits enter, update our page. If they're typing "15" then this
                                // will jump to page 15.
                                updatePage(state);
                                break;
                            }
                            case "ArrowUp": {
                                event.preventDefault();
                                event.stopPropagation();

                                if (state.isFocused && /\d+/.test(state.value)) {
                                    const valueNumber = parseInt(state.value, 10);
                                    setStateAndUpdatePage({
                                        isFocused: true,
                                        value: String(clamp(1, valueNumber + 1, notepadPageCount)),
                                        shouldSelectRef: {current: true},
                                    });
                                }
                                break;
                            }
                            case "ArrowDown": {
                                event.preventDefault();
                                event.stopPropagation();

                                if (state.isFocused && /\d+/.test(state.value)) {
                                    const valueNumber = parseInt(state.value, 10);
                                    setStateAndUpdatePage({
                                        isFocused: true,
                                        value: String(clamp(1, valueNumber - 1, notepadPageCount)),
                                        shouldSelectRef: {current: true},
                                    });
                                }
                                break;
                            }
                        }
                    }}
                />
            </FocusRing>
            <Box
                // Only used for layout, screen readers should ignore.
                aria-hidden={true}
                pointerEvents="none"
                opacity="0"
                display="inline-block"
                paddingX="1"
                paddingY="0.5"
                border="grey-10"
                borderRadius="base"
                maxWidth="32"
                style={{fontVariantNumeric: "tabular-nums"}}
            >
                {inputValue.length === 0 ? inputPlaceholder : inputValue}
            </Box>
        </Box>
    );
}
