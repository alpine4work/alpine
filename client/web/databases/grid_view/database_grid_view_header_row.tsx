// -- Header row ---------------------------------------------------------------

import {type Icon as PhosphorIcon, Plus} from "phosphor-react";
import {Ref, forwardRef, useEffect, useRef, useState} from "react";
import {mergeProps, useHover} from "react-aria";
import {DatabaseFieldVisibilityMenu} from "~/client/web/databases/database_field_visibility_menu.js";
import {
    databaseFieldComponentProviders,
    getDatabaseFieldComponentProvider,
} from "~/client/web/databases/fields/database_field_component_providers.js";
import {DatabaseRelationFieldCreationOptions} from "~/client/web/databases/fields/database_relation_field_creation_options.js";
import {gridRowHeight} from "~/client/web/databases/grid_view/database_grid_view_constants.js";
import {
    DatabaseGridViewField,
    DatabaseGridViewFieldEditing,
    DatabaseGridViewFieldWithEditing,
} from "~/client/web/databases/grid_view/use_grid_view_fields.js";
import {Box} from "~/client/web/design/box.js";
import {IconButton} from "~/client/web/design/icon_button.js";
import {MenuButton} from "~/client/web/design/menu_button.js";
import {Overlay} from "~/client/web/design/overlay.js";
import {OverlayTriggerButton} from "~/client/web/design/overlay_trigger_button.js";
import {TextInputWithoutLabel} from "~/client/web/design/text_input.js";
import {useEvent} from "~/client/web/helpers/lifecycle/use_event.js";
import {useMergedRefs} from "~/client/web/helpers/refs/use_merged_refs.js";
import {sprinkles} from "~/client/web/styles/styles.js";
import {
    DatabaseFieldConfig,
    DatabaseFieldType,
} from "~/shared/databases/fields/all_database_field_providers.js";
import {OrderKey} from "~/shared/helpers/sort/order_key.js";
import {DatabaseFieldId} from "~/shared/id/types/id_types.js";
import {maxLabelStringLength} from "~/shared/schema/helpers/label_string_schema.js";

export function DatabaseGridViewHeaderRow({
    fields,
    hiddenFields,
    onStartAddingField,
    startResizingField,
    resizingState,
    onRenameField,
    onUpdateFieldVisibility,
    onUpdateFieldConfig,
}: {
    fields: ReadonlyArray<DatabaseGridViewFieldWithEditing>;
    hiddenFields: ReadonlyArray<DatabaseGridViewField>;
    onStartAddingField: () => void;
    startResizingField: (
        fieldId: DatabaseFieldId,
        event: React.PointerEvent,
    ) => {
        onMove: (event: PointerEvent) => void;
        onRelease: (event: PointerEvent) => void;
        onCancel: () => void;
    };
    resizingState: {readonly fieldId: DatabaseFieldId} | null;
    onRenameField: (fieldId: DatabaseFieldId, name: string) => void;
    onUpdateFieldVisibility: (
        fieldId: DatabaseFieldId,
        position: OrderKey,
        isVisible: boolean,
    ) => void;
    onUpdateFieldConfig: (fieldId: DatabaseFieldId, config: DatabaseFieldConfig) => void;
}) {
    return (
        <Box display="flex" height={gridRowHeight}>
            {fields.map(field => (
                <DatabaseGridViewHeaderCell
                    key={field.id}
                    field={field}
                    startResizingField={startResizingField}
                    isResizingThisField={resizingState?.fieldId === field.id}
                    onRenameField={onRenameField}
                    onUpdateFieldConfig={onUpdateFieldConfig}
                />
            ))}
            <Box
                display="flex"
                alignItems="center"
                flexShrink="0"
                backgroundColor="grey-0"
                paddingX="1"
                gap="0.5"
            >
                <IconButton
                    description="Add field"
                    size="sm"
                    variant="quiet-above-grey-5-background"
                    onPress={onStartAddingField}
                >
                    <Plus />
                </IconButton>
                <DatabaseFieldVisibilityMenu
                    shownFields={fields}
                    hiddenFields={hiddenFields}
                    onUpdateFieldVisibility={onUpdateFieldVisibility}
                />
            </Box>
            <Box backgroundColor="grey-0" flexGrow="1" />
        </Box>
    );
}

function DatabaseGridViewHeaderCell({
    field,
    startResizingField,
    isResizingThisField,
    onRenameField,
    onUpdateFieldConfig,
}: {
    field: DatabaseGridViewFieldWithEditing;
    startResizingField: (
        fieldId: DatabaseFieldId,
        event: React.PointerEvent,
    ) => {
        onMove: (event: PointerEvent) => void;
        onRelease: (event: PointerEvent) => void;
        onCancel: () => void;
    };
    isResizingThisField: boolean;
    onRenameField: (fieldId: DatabaseFieldId, name: string) => void;
    onUpdateFieldConfig: (fieldId: DatabaseFieldId, config: DatabaseFieldConfig) => void;
}) {
    const inputRef = useRef<HTMLInputElement>(null);
    const editing = field.editing;

    useEffect(() => {
        if (editing != null) {
            const input = inputRef.current;
            if (input) {
                input.focus();
                input.select();
            }
        }
    }, [editing != null]); // eslint-disable-line react-hooks/exhaustive-deps

    return (
        <Box backgroundColor="grey-0" position="relative" style={field.columnStyle}>
            {editing ? (
                <Overlay
                    isVisible={true}
                    placement="bottom-start"
                    fallbackPlacements={["bottom-end"]}
                    preventOverflow={false}
                    overlay={
                        <DatabaseGridViewFieldTypePicker
                            editing={editing}
                            onSelect={type => editing.commitWithType(type)}
                        />
                    }
                >
                    <input
                        ref={inputRef}
                        value={field.name}
                        maxLength={maxLabelStringLength}
                        onChange={e => editing.updateName(e.currentTarget.value)}
                        onBlur={() => editing.commit()}
                        onKeyDown={e => {
                            if (e.key === "Enter") {
                                e.preventDefault();
                                editing.commit();
                            } else if (e.key === "Escape") {
                                e.preventDefault();
                                editing.cancel();
                            }
                            e.stopPropagation();
                        }}
                        className={sprinkles({
                            width: "full",
                            padding: "2",
                            fontSize: "75",
                            color: "grey-80",
                        })}
                    />
                </Overlay>
            ) : (
                <DatabaseGridViewHeaderEditor
                    field={field}
                    onRenameField={onRenameField}
                    onUpdateFieldConfig={onUpdateFieldConfig}
                />
            )}
            <DatabaseGridViewResizeHandle
                fieldId={field.id}
                startResizingField={startResizingField}
                isResizingThisField={isResizingThisField}
            />
        </Box>
    );
}

// -- Field header editor (rename + config menu) ------------------------------

function DatabaseGridViewHeaderEditor({
    field,
    onRenameField,
    onUpdateFieldConfig,
}: {
    field: DatabaseGridViewFieldWithEditing;
    onRenameField: (fieldId: DatabaseFieldId, name: string) => void;
    onUpdateFieldConfig: (fieldId: DatabaseFieldId, config: DatabaseFieldConfig) => void;
}) {
    const provider = getDatabaseFieldComponentProvider(field.config.type);
    const Icon = provider.Icon;
    const inputRef = useRef<HTMLInputElement>(null);
    const [draftName, setDraftName] = useState(field.name);

    useEffect(() => {
        setDraftName(field.name);
    }, [field.name]);

    const commitRename = useEvent(() => {
        const trimmed = (inputRef.current?.value ?? draftName).trim();
        if (trimmed === "" || trimmed === field.name) return;
        onRenameField(field.id, trimmed);
    });

    const configActions =
        provider.getConfigMenuActions?.({
            config: field.config,
            onCommit: config => onUpdateFieldConfig(field.id, config),
        }) ?? [];

    const renameInput = (
        <DatabaseGridViewHeaderRenameInput
            inputRef={inputRef}
            value={draftName}
            onChange={setDraftName}
            onEnter={commitRename}
            onEscape={() => setDraftName(field.name)}
            paddingBottom={configActions.length > 0 ? "1" : "1.5"}
        />
    );

    const trigger = (
        <Box
            role="button"
            tabIndex={0}
            cursor="pointer"
            display="flex"
            alignItems="center"
            color="grey-80"
            fontSize="75"
            fontStyle="truncate-semi-bold"
            padding="2"
            textAlign="left"
            gap="1"
            style={{userSelect: "none"}}
        >
            <Box color="grey-50" display="flex" alignItems="center">
                <Icon size={14} />
            </Box>
            <Box fontStyle="truncate-semi-bold">{field.name}</Box>
        </Box>
    );

    if (configActions.length === 0) {
        return (
            <OverlayTriggerButton
                withoutButtonElementRequirement
                placement="bottom-start"
                aria-haspopup="dialog"
                onClose={commitRename}
                overlay={<DatabaseGridViewHeaderEditorRenameOverlay renameInput={renameInput} />}
            >
                {trigger}
            </OverlayTriggerButton>
        );
    }

    return (
        <MenuButton
            withoutButtonElementRequirement
            placement="bottom-start"
            actions={configActions}
            onClose={commitRename}
            extraOverlayTop={renameInput}
        >
            {trigger}
        </MenuButton>
    );
}

const DatabaseGridViewHeaderEditorRenameOverlay = forwardRef(
    function DatabaseGridViewHeaderEditorRenameOverlay(
        {renameInput}: {renameInput: React.ReactNode},
        ref: Ref<HTMLDivElement>,
    ) {
        return (
            <Box
                ref={ref}
                backgroundColor="grey-0"
                borderRadius="1.5"
                boxShadow="elevation-20"
                style={{minWidth: 200}}
            >
                {renameInput}
            </Box>
        );
    },
);

function DatabaseGridViewHeaderRenameInput({
    inputRef,
    value,
    onChange,
    onEnter,
    onEscape,
    paddingBottom,
}: {
    inputRef: Ref<HTMLInputElement>;
    value: string;
    onChange: (value: string) => void;
    onEnter: () => void;
    onEscape: () => void;
    paddingBottom: "1" | "1.5";
}) {
    const internalRef = useRef<HTMLInputElement>(null);
    const mergedRef = useMergedRefs(inputRef, internalRef);

    useEffect(() => {
        const input = internalRef.current;
        if (input) {
            input.focus();
            input.select();
        }
    }, []);

    return (
        <Box paddingX="1.5" paddingTop="1.5" paddingBottom={paddingBottom}>
            <TextInputWithoutLabel
                ref={mergedRef}
                aria-label="Field name"
                value={value}
                maxLength={maxLabelStringLength}
                onChange={onChange}
                onEnter={onEnter}
                onEscape={onEscape}
            />
        </Box>
    );
}

// -- Field type picker --------------------------------------------------------

function DatabaseGridViewFieldTypePicker({
    ref,
    editing,
    onSelect,
}: {
    ref?: React.Ref<HTMLElement>;
    editing: DatabaseGridViewFieldEditing;
    onSelect: (type: DatabaseFieldType) => void;
}) {
    return (
        <Box
            ref={ref as React.Ref<HTMLDivElement>}
            backgroundColor="grey-0"
            borderRadius="1.5"
            boxShadow="elevation-20"
            padding="1"
            style={{minWidth: 120}}
        >
            {databaseFieldComponentProviders.map(provider => (
                <DatabaseGridViewFieldTypePickerOption
                    key={provider.type}
                    type={provider.type}
                    label={provider.label}
                    Icon={provider.Icon}
                    isSelected={provider.type === editing.fieldType}
                    onSelect={type => {
                        if (type === "relation") {
                            editing.updateType(type);
                        } else {
                            onSelect(type);
                        }
                    }}
                />
            ))}
            {editing.fieldType === "relation" ? (
                <DatabaseRelationFieldCreationOptions editing={editing} />
            ) : null}
        </Box>
    );
}

function DatabaseGridViewFieldTypePickerOption({
    type,
    label,
    Icon,
    isSelected,
    onSelect,
}: {
    type: DatabaseFieldType;
    label: string;
    Icon: PhosphorIcon;
    isSelected: boolean;
    onSelect: (type: DatabaseFieldType) => void;
}) {
    const {hoverProps, isHovered} = useHover({});
    return (
        <Box
            {...hoverProps}
            display="flex"
            alignItems="center"
            gap="1.5"
            padding="1.5"
            borderRadius="1"
            fontSize="75"
            color="grey-100"
            cursor="pointer"
            backgroundColor={isSelected ? "theme-10" : isHovered ? "grey-5" : undefined}
            onMouseDown={e => {
                e.preventDefault();
                onSelect(type);
            }}
        >
            <Icon size={14} />
            {label}
        </Box>
    );
}

// -- Resize handle ------------------------------------------------------------

function DatabaseGridViewResizeHandle({
    fieldId,
    startResizingField,
    isResizingThisField,
}: {
    fieldId: DatabaseFieldId;
    startResizingField: (
        fieldId: DatabaseFieldId,
        event: React.PointerEvent,
    ) => {
        onMove: (event: PointerEvent) => void;
        onRelease: (event: PointerEvent) => void;
        onCancel: () => void;
    };
    isResizingThisField: boolean;
}) {
    const {hoverProps, isHovered} = useHover({});

    const [resizeHandlers, setResizeHandlers] = useState<{
        onMove: (event: PointerEvent) => void;
        onRelease: (event: PointerEvent) => void;
        onCancel: () => void;
    } | null>(null);

    const isResizing = resizeHandlers != null;
    const showBar = isHovered || isResizing || isResizingThisField;

    return (
        <Box
            position="absolute"
            top="0"
            bottom="0"
            right="-2"
            width="4"
            cursor="col-resize"
            zIndex="10"
            touchAction="none"
            {...mergeProps(hoverProps, {
                onPointerDown(event: React.PointerEvent) {
                    const handlers = startResizingField(fieldId, event);
                    setResizeHandlers(handlers);
                    event.currentTarget.setPointerCapture(event.pointerId);
                },
                onPointerMove(event: React.PointerEvent) {
                    resizeHandlers?.onMove(event.nativeEvent);
                },
                onPointerUp(event: React.PointerEvent) {
                    resizeHandlers?.onRelease(event.nativeEvent);
                    setResizeHandlers(null);
                },
                onPointerCancel() {
                    resizeHandlers?.onCancel();
                    setResizeHandlers(null);
                },
                onLostPointerCapture() {
                    resizeHandlers?.onCancel();
                    setResizeHandlers(null);
                },
            })}
        >
            <Box
                position="absolute"
                top="0"
                bottom="0"
                backgroundColor={showBar ? "theme-40-const" : "transparent"}
                style={{
                    left: 7,
                    width: 2,
                }}
            />
        </Box>
    );
}
