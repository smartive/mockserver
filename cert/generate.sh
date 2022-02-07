#!/bin/bash

openssl req -x509 -out `dirname "$0"`/localhost.crt -keyout `dirname "$0"`/localhost.key \
  -newkey rsa:2048 -nodes -sha256 -days 1460 \
  -subj '/CN=localhost' -extensions EXT -config <( \
   printf "[dn]\nCN=localhost\n[req]\ndistinguished_name = dn\n[EXT]\nsubjectAltName=DNS:localhost\nkeyUsage=digitalSignature\nextendedKeyUsage=serverAuth")
