#!/bin/bash

RUNFILES="$0.runfiles"

"$RUNFILES/cyberworlds/$JAVA" "-Djava.library.path=$RUNFILES/dynamo_local/DynamoDBLocal_lib" -jar "$RUNFILES/dynamo_local/DynamoDBLocal.jar" $@
