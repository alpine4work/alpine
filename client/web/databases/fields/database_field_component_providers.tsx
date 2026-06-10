import {databaseCheckboxFieldComponentProvider} from "~/client/web/databases/fields/database_checkbox_field_component.js";
import type {DatabaseFieldComponentProviderBase} from "~/client/web/databases/fields/database_field_component_provider.js";
import {databaseNumberFieldComponentProvider} from "~/client/web/databases/fields/database_number_field_component.js";
import {databasePlainTextFieldComponentProvider} from "~/client/web/databases/fields/database_plain_text_field_component.js";
import {databaseRelationFieldComponentProvider} from "~/client/web/databases/fields/database_relation_field_component.js";
import type {DatabaseFieldType} from "~/shared/databases/fields/database_field_providers.js";
import {assert} from "~/shared/helpers/control/assert.js";

/**
 * All known field component providers. Use this for iteration (e.g. rendering the
 * type picker).
 */
export const databaseFieldComponentProviders = [
    databasePlainTextFieldComponentProvider,
    databaseCheckboxFieldComponentProvider,
    databaseNumberFieldComponentProvider,
    databaseRelationFieldComponentProvider,
] as const;

/**
 * Per-field-type client rendering provider. Derived from the registered component
 * providers so `type` is the literal union, not `string`.
 */
export type DatabaseFieldComponentProvider = (typeof databaseFieldComponentProviders)[number];

const providersByType = new Map<DatabaseFieldType, DatabaseFieldComponentProviderBase>(
    databaseFieldComponentProviders.map(
        p => [p.type, p] as [DatabaseFieldType, DatabaseFieldComponentProviderBase],
    ),
);

/**
 * Look up the component provider for a given field type. Returns {@link
 * DatabaseFieldComponentProviderBase} so components are instantiable without
 * knowing the concrete field type.
 */
export function getDatabaseFieldComponentProvider(
    type: DatabaseFieldType,
): DatabaseFieldComponentProviderBase {
    const provider = providersByType.get(type);
    assert(provider != null, `unknown field type: ${type}`);
    return provider;
}
