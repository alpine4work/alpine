import {TaskIndexDoc} from "~/server/tasks/data/task_index_doc.js";
import {TaskAction} from "~/shared/tasks/actions/task_action.js";

export class TaskRealtimeActionTransaction {
    public send() {
        // NOCOMMIT
    }
}

export abstract class TaskRealtimeActionTransactionSliceBase {
    public readonly transaction: TaskRealtimeActionTransaction;

    constructor(transaction: TaskRealtimeActionTransaction) {
        this.transaction = transaction;
    }

    public accept(send: () => void) {}
}

export class TaskRealtimeActionTransactionActionsSlice extends TaskRealtimeActionTransactionSliceBase {
    constructor(transaction: TaskRealtimeActionTransaction, actions: Array<TaskAction>) {
        super(transaction);
    }
}

export class TaskRealtimeActionTransactionBackfillTaskSlice extends TaskRealtimeActionTransactionSliceBase {
    constructor(transaction: TaskRealtimeActionTransaction, task: TaskIndexDoc) {
        super(transaction);
    }
}
