import {TestCheckpoint} from "~/shared/helpers/test/test_checkpoint.open_source.js";
import {AccountId} from "~/shared/id/types/id_types.open_source.js";

export const deleteTaskAndAllChildrenBeforeExecuteTestCheckpoint = new TestCheckpoint<AccountId>();
