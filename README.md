# Mockserver

[![npm version](https://badge.fury.io/js/@smartive%2Fmockserver.svg)](https://www.npmjs.com/package/@smartive/mockserver)
[![Docker Pulls](https://img.shields.io/docker/pulls/smartive/mockserver)](https://hub.docker.com/r/smartive/mockserver)

A lightweight, powerful mock server with API recording and replay capabilities for E2E testing. Perfect for mocking server-side API calls in applications with Server-Side Rendering (SSR).

## Why This Mock Server?

Modern web frameworks like Next.js, Remix, and SvelteKit fetch data server-side for better SEO and performance. Traditional browser-based mocking tools can't intercept these server-side requests, making E2E testing challenging.

### The Problem

**Client-Side Rendering (CSR):**

```
Browser → External API ✅ Easy to mock with browser tools
```

**Server-Side Rendering (SSR):**

```
Browser → App Server → External API ❌ Browser tools can't intercept
```

### The Solution

Instead of intercepting requests, let them flow naturally to a mock server:

```
Browser → App Server → Mock Server → External API (in record mode)
Browser → App Server → Mock Server (in replay mode)
```

## Key Features

- 🎯 **Proxy Mode with Recording**: Record real API responses automatically
- 🔄 **Replay Mode**: Use recorded responses for deterministic testing
- 📝 **Manual Mocking**: Define custom mock responses via HTTP API
- 📧 **SMTP Server**: Built-in mail server for email testing
- 🔍 **Request Inspection**: Track all incoming requests and emails
- 🐳 **Docker Ready**: Available as a lightweight Docker image
- ⚡ **Simple & Fast**: ~350 lines of code, minimal dependencies

## Quick Start

### Using Docker (Recommended)

```bash
docker run -p 1080:1080 smartive/mockserver
```

### Using Docker Compose

```yaml
version: '3.3'
services:
  mockserver:
    image: smartive/mockserver
    ports:
      - '1080:1080'
      - '25:25' # Optional: SMTP server
    environment:
      MOCK_PATH: /mock
      MOCK_HOST: 0.0.0.0
      MOCK_HTTP_PORT: 1080
      MOCK_SMTP_PORT: 25
```

### Using npm/npx

```bash
# Run directly without installation
npx @smartive/mockserver

# Or install globally
npm install -g @smartive/mockserver
mockserver
```

### From Source

```bash
git clone https://github.com/smartive/mockserver.git
cd mockserver
npm install
npm start
```

## Usage Patterns

### Pattern 1: Record & Replay (Recommended)

This is the most powerful pattern - record real API responses and replay them deterministically.

#### Step 1: Configure Your App

Point your app's API base URL to the mock server. The mock server expects the original host as part of the URL path:

```bash
# .env.test
STORYBLOK_API_BASE_URL="http://localhost:1080/api.storyblok.com"
```

This transforms requests from:

```
https://api.storyblok.com/v2/cdn/stories/home
```

to:

```
http://localhost:1080/api.storyblok.com/v2/cdn/stories/home
```

#### Step 2: Record Mode

Enable recording to capture real API responses:

```javascript
// Enable recording mode
await fetch('http://localhost:1080/mock/recordings', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    active: true,
    // Optional: Remove dynamic fields from hash calculation
    deleteBodyAttributesForHash: ['timestamp', 'requestId'],
    deleteHeadersForHash: ['authorization', 'x-request-id'],
  }),
});

// Run your E2E tests - all API calls will be recorded
await page.goto('http://localhost:3000');
// ... perform your test actions ...
```

#### Step 3: Export Recordings

After recording, export the captured responses:

```javascript
const response = await fetch('http://localhost:1080/mock/recordings');
const recordings = await response.json();

// Save to your repository
import { writeFileSync } from 'fs';
writeFileSync('test/e2e/recordings/home.json', JSON.stringify(recordings, null, 2));
```

⚠️ **Important**: Review exported recordings for sensitive data (API keys, tokens, passwords) before committing!

#### Step 4: Replay Mode

In your CI or test environment, use the recorded responses:

```javascript
import recordings from '../recordings/home.json';

test('renders homepage with mocked data', async ({ page }) => {
  // Load recordings into mock server
  await fetch('http://localhost:1080/mock/recordings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      active: false, // Replay mode
      recordings,
    }),
  });

  await page.goto('http://localhost:3000');
  await expect(page.getByText('Expected Content')).toBeVisible();
});
```

### Pattern 2: Manual Mocking

For simpler scenarios or testing edge cases, define mock responses manually:

```javascript
// Mock a specific endpoint
await fetch('http://localhost:1080/mock/mock', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    request: {
      match: '/api.example.com/users/.*', // Regex pattern
      bodyMatch: '.*premium.*', // Optional: match request body
    },
    response: {
      status: 200,
      contentType: 'application/json',
      body: {
        id: '123',
        name: 'Test User',
        tier: 'premium',
      },
    },
  }),
});
```

#### Multiple Responses

Return different responses for consecutive calls:

```javascript
await fetch('http://localhost:1080/mock/mock', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    request: {
      match: '/api.example.com/status',
    },
    response: {
      status: 200,
      bodies: [{ status: 'processing' }, { status: 'completed' }],
    },
  }),
});
```

### Pattern 3: Email Testing

The built-in SMTP server captures emails for testing:

```javascript
// Send an email from your app
// ...

// Wait for and retrieve the email
const emailResponse = await fetch('http://localhost:1080/mock/mails/next');
const email = await emailResponse.text();

// Assert email contents
expect(email).toContain('Welcome to our service');
```

## API Reference

### Recording Endpoints

#### `POST /mock/recordings`

Configure recording/replay mode.

**Request Body:**

```javascript
{
  active: true,  // true = record mode, false = replay mode
  recordings: {},  // Recordings to load in replay mode
  deleteBodyAttributesForHash: ["timestamp"],  // Exclude from hash
  deleteHeadersForHash: ["authorization"],  // Exclude from hash
  forwardHeadersForRoute: [  // Forward headers in proxy mode
    {
      route: "/api.example.com",
      headers: { "X-API-Key": "secret" }
    }
  ],
  failedRequestsResponse: {}  // Response when no match found (optional)
}
```

**Response:** `204 No Content`

#### `GET /mock/recordings`

Retrieve all recorded API responses.

**Response:**

```javascript
{
  "hash1": [{
    request: { url: "...", method: "GET", headers: {...}, body: {} },
    body: { /* response body */ },
    status: 200,
    durationMs: 150
  }],
  "hash2": [...]
}
```

#### `POST /mock/recordings/rehash`

Recalculate hashes for all recordings based on current hash configuration.

**Response:** Updated recordings object

### Mock Endpoints

#### `POST /mock/mock`

Register a manual mock route.

**Request Body:**

```javascript
{
  request: {
    match: "/api\\.example\\.com/users/.*",  // URL regex
    bodyMatch: ".*premium.*"  // Optional: request body regex
  },
  response: {
    status: 200,
    contentType: "application/json",  // Optional
    body: { /* response data */ },
    // OR for multiple responses:
    bodies: [{ /* first */ }, { /* second */ }]
  }
}
```

**Response:** `204 No Content`

#### `GET /mock/routes`

List all registered mock routes.

**Response:** Array of route configurations

### Request Inspection

#### `GET /mock/calls`

Get all captured requests.

**Response:**

```javascript
[
  {
    method: 'GET',
    url: '/api.example.com/users/123',
    headers: {
      /* ... */
    },
    body: {
      /* ... */
    },
  },
];
```

#### `GET /mock/calls/next`

Wait for the next request (long-polling).

**Response:** Single request object (when available)

### Email Testing

#### `GET /mock/mails`

Get all captured emails.

**Response:** Array of raw email messages

#### `GET /mock/mails/next`

Wait for the next email (long-polling).

**Response:** Single email message (when available)

### Utility Endpoints

#### `POST /mock/reset`

Reset all state (routes, recordings, calls, emails).

**Response:** `204 No Content`

#### `POST /mock/reset/calls`

Reset only calls and emails (keeps routes and recordings).

**Response:** `204 No Content`

## Configuration

Configure the server using environment variables:

| Variable                          | Default   | Description                  |
| --------------------------------- | --------- | ---------------------------- |
| `MOCK_HTTP_PORT` or `PORT`        | `1080`    | HTTP server port             |
| `MOCK_HTTPS_PORT` or `HTTPS_PORT` | -         | HTTPS server port (optional) |
| `MOCK_SMTP_PORT` or `SMTP_PORT`   | `25`      | SMTP server port             |
| `MOCK_HOST` or `HOST`             | `0.0.0.0` | Server host                  |
| `MOCK_PATH`                       | `/mock`   | Base path for API endpoints  |

### HTTPS Support

To enable HTTPS, set the `MOCK_HTTPS_PORT` environment variable and provide SSL certificates:

```bash
# Certificate files must be at:
# - cert/localhost.key
# - cert/localhost.crt

MOCK_HTTPS_PORT=1443 npm start
```

## Complete Example: Playwright Test

```javascript
import { test, expect } from '@playwright/test';
import recordings from './recordings/homepage.json';

test.describe('Homepage E2E', () => {
  test.beforeEach(async () => {
    // Reset mock server
    await fetch('http://localhost:1080/mock/reset', { method: 'POST' });

    // Load recordings
    await fetch('http://localhost:1080/mock/recordings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        active: false,
        recordings,
      }),
    });
  });

  test('displays content from mocked API', async ({ page }) => {
    await page.goto('http://localhost:3000');

    // Verify content rendered from mock data
    await expect(page.getByText('Mock Server with API Recording')).toBeVisible();

    // Verify API was called
    const calls = await fetch('http://localhost:1080/mock/calls').then((r) => r.json());
    expect(calls.length).toBeGreaterThan(0);
  });

  test('handles API errors gracefully', async ({ page }) => {
    // Override with error response
    await fetch('http://localhost:1080/mock/mock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        request: { match: '/api.example.com/.*' },
        response: { status: 500, body: { error: 'Internal Server Error' } },
      }),
    });

    await page.goto('http://localhost:3000');
    await expect(page.getByText('Something went wrong')).toBeVisible();
  });
});
```

## Recording Script Example

Create a script to record new API interactions:

```javascript
// scripts/record-api.js
import { chromium } from '@playwright/test';
import { writeFileSync } from 'fs';

async function record() {
  // Start recording
  await fetch('http://localhost:1080/mock/recordings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      active: true,
      deleteBodyAttributesForHash: ['timestamp', '_v'],
      deleteHeadersForHash: ['cookie', 'authorization'],
    }),
  });

  // Run through your app
  const browser = await chromium.launch();
  const page = await browser.newPage();

  await page.goto('http://localhost:3000');
  await page.click('text=Get Started');
  await page.fill('#email', 'test@example.com');
  await page.click('button[type=submit]');

  await browser.close();

  // Export recordings
  const response = await fetch('http://localhost:1080/mock/recordings');
  const recordings = await response.json();

  writeFileSync('test/recordings/user-flow.json', JSON.stringify(recordings, null, 2));

  console.log('✅ Recordings saved to test/recordings/user-flow.json');
}

record().catch(console.error);
```

Run it with:

```bash
node scripts/record-api.js
```

## Best Practices

### 1. Keep Recordings Small and Focused

Record separate files for different test scenarios:

```
test/recordings/
  ├── homepage.json
  ├── login-flow.json
  ├── checkout.json
  └── admin-panel.json
```

### 2. Sanitize Sensitive Data

Always exclude sensitive information from recordings:

```javascript
{
  active: true,
  deleteBodyAttributesForHash: [
    "password",
    "token",
    "apiKey",
    "creditCard"
  ],
  deleteHeadersForHash: [
    "authorization",
    "cookie",
    "x-api-key"
  ]
}
```

### 3. Version Your Recordings

Commit recordings to version control alongside your tests:

```bash
git add test/recordings/
git commit -m "Update API recordings for new endpoint"
```

### 4. Reset Between Tests

Always reset the mock server to ensure test isolation:

```javascript
test.beforeEach(async () => {
  await fetch('http://localhost:1080/mock/reset', { method: 'POST' });
});
```

### 5. Handle Missing Recordings Gracefully

Use `failedRequestsResponse` to provide fallbacks:

```javascript
await fetch('http://localhost:1080/mock/recordings', {
  method: 'POST',
  body: JSON.stringify({
    active: false,
    recordings,
    failedRequestsResponse: {
      error: 'Not found in recordings',
      data: null,
    },
  }),
});
```

## Troubleshooting

### Recordings Not Matching

If recordings aren't being replayed:

1. Check the hash by examining the error message in server logs
2. Ensure `deleteBodyAttributesForHash` and `deleteHeadersForHash` exclude dynamic fields
3. Use `POST /mock/recordings/rehash` to recalculate hashes after changing configuration

### Large Recording Files

If recordings are too large:

1. Split into multiple smaller files per test/feature
2. Remove unnecessary fields using `deleteBodyAttributesForHash`
3. Consider recording only critical paths, use manual mocks for edge cases

### HTTPS Certificate Errors

When using HTTPS mode, you may need to trust self-signed certificates:

```javascript
// In Playwright
const context = await browser.newContext({
  ignoreHTTPSErrors: true,
});
```

### Port Already in Use

If port 1080 is occupied:

```bash
# Use a different port
MOCK_HTTP_PORT=8080 npm start

# Or find and kill the process
lsof -ti:1080 | xargs kill -9
```

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

ISC

## Links

- [GitHub Repository](https://github.com/smartive/mockserver)
- [npm Package](https://www.npmjs.com/package/@smartive/mockserver)
- [Docker Hub](https://hub.docker.com/r/smartive/mockserver)
- [Issues](https://github.com/smartive/mockserver/issues)

---

Built with ❤️ by [smartive](https://smartive.ch)
