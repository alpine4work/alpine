import {EventEmitter} from "~/shared/helpers/control/event_emitter.open_source.js";
import {TaskRealtimeClientId} from "~/shared/id/types/id_types.js";
import {SpaceId} from "~/shared/id/types/id_types.open_source.js";
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
