import {CaretRight} from "phosphor-react";
import {type Ref, useImperativeHandle, useState} from "react";
import {useHover} from "react-aria";
import {
    type DatabaseFieldComponentProvider,
    databaseFieldComponentProviders,
} from "~/client/web/databases/fields/database_field_component_providers.js";
import {DatabaseGridViewFieldCreationPageRef} from "~/client/web/databases/grid_view/database_grid_view_field_creation_page_ref.js";
import {
    DatabaseGridViewNewField,
    DatabaseGridViewNewFieldConfig,
} from "~/client/web/databases/use_grid_view_fields.js";
import {Box} from "~/client/web/design/box.js";
import {useEvent} from "~/client/web/helpers/lifecycle/use_event.js";
import {DatabaseFieldType} from "~/shared/databases/fields/all_database_field_providers.js";

/**
 * The first page of the field creation popover: the list of field types. Up and
 * down arrows forwarded from the field name input move the highlighted type; enter
 * or a click commits it. Picking "Linked record" advances to the linked table page
 * instead of committing.
 */
export function DatabaseGridViewFieldCreationTypePage({
    ref,
    name,
    onCommit,
    onPickRelation,
}: {
    ref: Ref<DatabaseGridViewFieldCreationPageRef>;
    name: string;
    onCommit: (newField: DatabaseGridViewNewField) => void;
    onPickRelation: () => void;
}) {
    const [highlightedIndex, setHighlightedIndex] = useState(0);

    const commitProvider = useEvent((provider: DatabaseFieldComponentProvider) => {
        if (provider.type === "relation") {
            onPickRelation();
            return;
        }
        // An empty name defaults to the field type's label.
        onCommit({
            name: name.trim() || provider.label,
            config: getDefaultDatabaseFieldConfig(provider.type),
        });
    });

    useImperativeHandle(ref, () => ({
        onNameInputKeyDown(event) {
            if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
            event.preventDefault();
            event.stopPropagation();
            const count = databaseFieldComponentProviders.length;
            const delta = event.key === "ArrowDown" ? 1 : -1;
            setHighlightedIndex(index => (index + delta + count) % count);
        },
        onNameInputEnter() {
            const provider = databaseFieldComponentProviders[highlightedIndex];
            if (provider != null) commitProvider(provider);
        },
    }));

    return (
        <Box role="listbox" aria-label="Field type" padding="1">
            {databaseFieldComponentProviders.map((provider, index) => (
                <DatabaseGridViewFieldCreationTypeOption
                    key={provider.type}
                    provider={provider}
                    isHighlighted={index === highlightedIndex}
                    onSelect={() => commitProvider(provider)}
                />
            ))}
        </Box>
    );
}

function DatabaseGridViewFieldCreationTypeOption({
    provider,
    isHighlighted,
    onSelect,
}: {
    provider: DatabaseFieldComponentProvider;
    isHighlighted: boolean;
    onSelect: () => void;
}) {
    const {hoverProps, isHovered} = useHover({});
    const Icon = provider.Icon;
    return (
        <Box
            {...hoverProps}
            role="option"
            aria-selected={isHighlighted}
            display="flex"
            alignItems="center"
            gap="1.5"
            padding="1.5"
            borderRadius="1"
            fontSize="75"
            color="grey-100"
            cursor="pointer"
            backgroundColor={isHighlighted ? "theme-10" : isHovered ? "grey-5" : undefined}
            // `onMouseDown` with `preventDefault()` so selecting an option doesn't blur the
            // focused name input.
            onMouseDown={event => {
                event.preventDefault();
                onSelect();
            }}
        >
            <Icon size={14} />
            <Box fontStyle="truncate">{provider.label}</Box>
            {provider.type === "relation" && (
                <Box marginLeft="auto" display="flex" alignItems="center" color="grey-50">
                    <CaretRight size={12} />
                </Box>
            )}
        </Box>
    );
}

function getDefaultDatabaseFieldConfig(
    type: Exclude<DatabaseFieldType, "relation">,
): DatabaseGridViewNewFieldConfig {
    switch (type) {
        case "checkbox":
            return {type: "checkbox"};
        case "number":
            return {type: "number", decimalPlaces: null};
        case "plainText":
            return {type: "plainText"};
    }
}
