#!/usr/bin/env bash

export NODE_OPTIONS=--openssl-legacy-provider
for i in `ls`; do [ -d $i ] && (echo $i; cd $i; npm run build; cd ..); done

