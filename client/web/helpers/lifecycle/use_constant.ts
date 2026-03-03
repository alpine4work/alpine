import {Memo, useState} from "react";

/**
 * Returns the value passed into this function when the component mounted and never
 * changes.
 */
export function useConstant<Value>(value: Value | (() => Value)): Memo<Value> {
    return useState(value)[0] as Memo<Value>;
}
