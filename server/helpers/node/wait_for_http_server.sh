#!/bin/bash

# Wait for an HTTP server to become available using netcat.
#
# Derived from:
# https://stackoverflow.com/questions/27599839/how-to-wait-for-an-open-port-with-netcat
while [ "$2" = "darwin" ] && [ ! nc -G 1 -z localhost $1 ]; do
    sleep 0.05
done
while [ "$2" != "darwin" ] && [ "$(nc -w 1 -z localhost $1)" ]; do
    sleep 0.05
done
