import {ProcessContext} from "~/server/context/context";

export class DurableObjectProcessContext implements ProcessContext {
    constructor(private readonly _state: DurableObjectState) {}

    public waitUntil(promise: Promise<void>): void {
        this._state.waitUntil(promise);
    }
}
