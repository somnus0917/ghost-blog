#!/usr/bin/env bash
set -euo pipefail

if [[ $# -gt 0 ]]; then
    if [[ ! -f "/home/tinybird/.tinyb" ]]; then
        echo "Not logged in to Tinybird. Run 'make analytics-login' first."
        exit 1
    fi
    exec tb "$@"
fi

if [[ -f "/home/tinybird/.tinyb" ]]; then
    echo "Tinybird already logged in"
    exit 0
fi

if [[ ! -t 0 ]] || [[ ! -t 1 ]]; then
    echo "Tinybird login requires an interactive terminal."
    echo "Run 'make analytics-login' first."
    exit 1
fi

tb login --method code
