# Mockserver

A simple node.js based web and mail mockserver

## Setup

```
npm i
npm start
```

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

## HTTPS

Set a `HTTPS_PORT` env variable to start an https server as well.
