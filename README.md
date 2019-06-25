# Mockserver

A simple node.js based mockserver

## Usage with Docker Compose

```
version: "3.3"
services:
  image: smartive/mockserver
  environment:
    MOCK_PATH: /mock
    HOST: 0.0.0.0
    PORT: 1080
```
