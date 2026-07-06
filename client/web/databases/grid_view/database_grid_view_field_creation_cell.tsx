import {type Ref, useEffect, useRef, useState} from "react";
import {DatabaseGridViewFieldCreationLinkedTablePage} from "~/client/web/databases/grid_view/database_grid_view_field_creation_linked_table_page.js";
import {DatabaseGridViewFieldCreationPageRef} from "~/client/web/databases/grid_view/database_grid_view_field_creation_page_ref.js";
import {DatabaseGridViewFieldCreationTypePage} from "~/client/web/databases/grid_view/database_grid_view_field_creation_type_page.js";
import {DatabaseGridViewNewField} from "~/client/web/databases/use_grid_view_fields.js";
import {Box} from "~/client/web/design/box.js";
import {useOutsidePress} from "~/client/web/design/helpers/use_outside_interaction.js";
import {Overlay} from "~/client/web/design/overlay.js";
import {TextInputWithoutLabel} from "~/client/web/design/text_input.js";
import {useEvent} from "~/client/web/helpers/lifecycle/use_event.js";
import {maxLabelStringLength} from "~/shared/schema/helpers/label_string_schema.js";

type DatabaseGridViewFieldCreationScreen = "fieldType" | "linkedTable";

/**
 * The header cell contents for a field that's being created: the field name input
 * inline in the header with the creation popover anchored below it. Owns the draft
 * name and which page of the popover is showing; each page owns the rest of its
 * state and reports the finished field through `onCommit`.
 *
 * Focus stays on the name input while the field type page is up, so its keyboard
 * events are forwarded to the active page (see {@link
 * DatabaseGridViewFieldCreationPageRef}).
 */
export function DatabaseGridViewFieldCreationCell({
    onCommit,
    onCancel,
}: {
    onCommit: (newField: DatabaseGridViewNewField) => void;
    onCancel: () => void;
}) {
    const [name, setName] = useState("");
    const [screen, setScreen] = useState<DatabaseGridViewFieldCreationScreen>("fieldType");

    const nameInputRef = useRef<HTMLInputElement>(null);
    const pageRef = useRef<DatabaseGridViewFieldCreationPageRef>(null);

    // Focus the name input when the field type page shows (both on mount and when
    // coming back from the linked table page, which focuses its own filter input).
    useEffect(() => {
        if (screen === "fieldType") nameInputRef.current?.focus();
    }, [screen]);

    // Escape steps back one level: from the linked table page to the field type page,
    // then out of the creation flow entirely.
    const handleEscape = useEvent(() => {
        if (screen === "linkedTable") {
            setScreen("fieldType");
        } else {
            onCancel();
        }
    });

    const outsidePressRef = useOutsidePress(() => onCancel());

    return (
        <Box ref={outsidePressRef} height="full">
            <Overlay
                isVisible={true}
                placement="bottom-start"
                fallbackPlacements={["bottom-end"]}
                preventOverflow={false}
                overlay={
                    <DatabaseGridViewFieldCreationPopover>
                        {screen === "fieldType" ? (
                            <DatabaseGridViewFieldCreationTypePage
                                ref={pageRef}
                                name={name}
                                onCommit={onCommit}
                                onPickRelation={() => setScreen("linkedTable")}
                            />
                        ) : (
                            <DatabaseGridViewFieldCreationLinkedTablePage
                                ref={pageRef}
                                name={name}
                                onCommit={onCommit}
                                onBack={() => setScreen("fieldType")}
                            />
                        )}
                    </DatabaseGridViewFieldCreationPopover>
                }
            >
                <Box height="full" display="flex" alignItems="center" paddingX="0.5">
                    <TextInputWithoutLabel
                        ref={nameInputRef}
                        aria-label="Field name"
                        withoutBorder
                        value={name}
                        placeholder="Field name"
                        maxLength={maxLabelStringLength}
                        onChange={setName}
                        onEnter={() => pageRef.current?.onNameInputEnter()}
                        onEscape={handleEscape}
                        onKeyDown={event => pageRef.current?.onNameInputKeyDown(event)}
                    />
                </Box>
            </Overlay>
        </Box>
    );
}

function DatabaseGridViewFieldCreationPopover({
    ref,
    children,
}: {
    ref?: Ref<HTMLElement>;
    children: React.ReactNode;
}) {
    return (
        <Box
            ref={ref as Ref<HTMLDivElement>}
            backgroundColor="grey-0"
            borderRadius="1.5"
            boxShadow="elevation-20"
            minWidth="48"
        >
            {children}
        </Box>
    );
}
