import {EventEmitter} from "~/shared/helpers/control/event_emitter.js";
import {SpaceId, TaskRealtimeClientId} from "~/shared/id/types/id_types.js";
import {TaskAction} from "~/shared/tasks/actions/task_action.js";

export const afterCommitTaskActionTransactionEventEmitterForTest = import.meta.jest
    ? new EventEmitter<{
          spaceId: SpaceId;
          committedTime: Date;
          actions: ReadonlyArray<TaskAction>;
          clientId: TaskRealtimeClientId | null;
          processPromise: Promise<void>;
      }>()
    : null;
