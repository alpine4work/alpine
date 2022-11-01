import {ComponentType} from "react";
import {ObjectSchemaConfigBase, ObjectSchemaConfigType} from "~/shared/schema/schema";

const deserializedPropsRefCurrentSymbol = Symbol("current");

export function withSchemaBridge<Config extends ObjectSchemaConfigBase>(
    propsSchema: Config,
    Component: ComponentType<ObjectSchemaConfigType<Config>>,
): {} {
    function SchemaBridgeComponent(props: ObjectSchemaConfigType<Config>) {}

    SchemaBridgeComponent.displayName = `SchemaBridge(${Component.displayName ?? Component.name})`;

    return SchemaBridgeComponent;
}
