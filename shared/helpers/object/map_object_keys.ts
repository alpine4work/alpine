/**
 * Creates a new object where all the keys are transformed by the map
 * function.
 *
 * We only transform own properties on the object. That means the type
 * signature of this function is technically unsound.
 */
export function mapObjectKeys<Value, NewKeyValue>(
    value: Value,
    map: (keyValue: Value[keyof Value], key: string) => NewKeyValue,
): {[Key in keyof Value]: NewKeyValue} {
    return Object.fromEntries(
        Object.entries<any>(value as any).map(([key, keyValue]) => {
            const newKeyValue = map(keyValue, key);
            return [key, newKeyValue];
        }),
    ) as any;
}
