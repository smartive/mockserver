# Mockserver

[![npm version](https://badge.fury.io/js/@smartive%2Fmockserver.svg)](https://www.npmjs.com/package/@smartive/mockserver)
[![Docker Pulls](https://img.shields.io/docker/pulls/smartive/mockserver)](https://hub.docker.com/r/smartive/mockserver)

Mock server with **API recording and replay** for E2E testing. Works as a proxy that can record real API responses and replay them deterministically.

## What makes it special?

- **Record & Replay**: Record real API calls, replay them in tests
- **Proxy mode**: Routes requests like `http://localhost:1080/api.example.com/path` → `https://api.example.com/path`
- **SMTP server**: Built-in mail server for email testing
- **HTTP API**: Configure mocks, recordings, and inspect requests via REST endpoints

## Quick Start

```bash
docker run -p 1080:1080 -p 25:25 smartive/mockserver
```

Or with npm:

```bash
npx @smartive/mockserver
```

## Usage

### Record & Replay

**1. Configure your app** to use the mockserver as proxy:

```bash
# .env.test
API_BASE_URL="http://localhost:1080/api.example.com"
```

**2. Record** real API responses:

```javascript
await fetch('http://localhost:1080/mock/recordings', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ active: true }),
});

// Run your app - all API calls are proxied and recorded
```

**3. Export** recordings:

```javascript
const recordings = await fetch('http://localhost:1080/mock/recordings').then((r) => r.json());
writeFileSync('recordings.json', JSON.stringify(recordings));
```

**4. Replay** in tests:

```javascript
import recordings from './recordings.json';

await fetch('http://localhost:1080/mock/recordings', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    active: false,
    recordings,
  }),
});

// All requests now use recorded responses
```

### Manual Mocking

```javascript
await fetch('http://localhost:1080/mock/mock', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    request: {
      match: '/api.example.com/users/.*', // Regex
    },
    response: {
      status: 200,
      body: { id: '123', name: 'Test User' },
    },
  }),
});
```

### Email Testing

```javascript
// Wait for next email
const email = await fetch('http://localhost:1080/mock/mails/next').then((r) => r.text());
expect(email).toContain('Welcome');
```

## API Endpoints

| Endpoint                  | Method | Description                          |
| ------------------------- | ------ | ------------------------------------ |
| `/mock/recordings`        | POST   | Configure recording/replay mode      |
| `/mock/recordings`        | GET    | Get all recordings                   |
| `/mock/recordings/rehash` | POST   | Recalculate recording hashes         |
| `/mock/mock`              | POST   | Register a mock route                |
| `/mock/routes`            | GET    | List all mock routes                 |
| `/mock/calls`             | GET    | Get all captured requests            |
| `/mock/calls/next`        | GET    | Wait for next request (long-polling) |
| `/mock/mails`             | GET    | Get all captured emails              |
| `/mock/mails/next`        | GET    | Wait for next email (long-polling)   |
| `/mock/reset`             | POST   | Reset all state                      |
| `/mock/reset/calls`       | POST   | Reset calls and emails               |

## Configuration

| Variable          | Default   | Description   |
| ----------------- | --------- | ------------- |
| `MOCK_HTTP_PORT`  | `1080`    | HTTP port     |
| `MOCK_HTTPS_PORT` | -         | HTTPS port    |
| `MOCK_SMTP_PORT`  | `25`      | SMTP port     |
| `MOCK_HOST`       | `0.0.0.0` | Host          |
| `MOCK_PATH`       | `/mock`   | API base path |

## Advanced Recording Options

```javascript
await fetch('http://localhost:1080/mock/recordings', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    active: true,
    deleteBodyAttributesForHash: ['timestamp'], // Ignore these fields in hash
    deleteHeadersForHash: ['authorization'], // Ignore these headers in hash
    forwardHeadersForRoute: [
      {
        route: '/api.example.com',
        headers: { 'X-API-Key': 'secret' },
      },
    ],
    failedRequestsResponse: { error: 'Not found' }, // Fallback response
  }),
});
```

## License

ISC
