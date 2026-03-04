const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const { SMTPServer } = require('smtp-server');
const crypto = require('crypto');
const { appendFile, mkdir } = require('fs/promises');
const path = require('path');
const { readdir, readFile, writeFile } = require('fs/promises');

const app = express();
const http = require('http');
const https = require('https');
const { readFileSync } = require('fs');
const dashboardHtml = readFileSync(path.join(__dirname, 'dashboard.html'), 'utf8');

const HTTP_PORT = process.env.MOCK_HTTP_PORT || process.env.PORT || 1080;
const HTTPS_PORT = process.env.MOCK_HTTPS_PORT || process.env.HTTPS_PORT;
const SMTP_PORT = process.env.MOCK_SMTP_PORT || process.env.SMTP_PORT || '25';
const HOST = process.env.MOCK_HOST || process.env.HOST || '0.0.0.0';
const MOCK_PATH = process.env.MOCK_PATH || '/mock';
const DEBUG_STATS_DIR = process.env.MOCK_DEBUG_STATS_DIR || 'debug';
const DEBUG_STATS_FILE = `${DEBUG_STATS_DIR}/request-stats.ndjson`;
const MOCKS_DIR = process.env.MOCKS_DIR || 'mocks';

let routes = [];
let calls = [];
let nextCallListeners = [];
let mails = [];
let nextMailListeners = [];
let recordingsContext = {
  active: false,
  deleteBodyAttributesForHash: [],
  forwardHeadersForRoute: [],
  deleteHeadersForHash: [],
  failedRequestsResponse: undefined,
  recordings: {},
};
let debugStatsInitPromise = Promise.resolve();
let mocksInitPromise = Promise.resolve();
const DEBUG_BODY_MAX_LENGTH = 20000;

function getMockFilePath(name) {
  const safeName = name.replace(/[^a-zA-Z0-9-_]/g, '_');
  return path.join(MOCKS_DIR, `${safeName}.json`);
}

async function initializeMocksDir() {
  await mkdir(MOCKS_DIR, { recursive: true });
  console.log(`Mocks directory enabled: ${MOCKS_DIR}`);
}

async function loadMocksFromDisk() {
  await mocksInitPromise;
  const entries = await readdir(MOCKS_DIR, { withFileTypes: true });
  const files = entries.filter((entry) => entry.isFile() && entry.name.endsWith('.json')).map((entry) => entry.name);

  const loadedRoutes = [];
  for (const fileName of files) {
    const fullPath = path.join(MOCKS_DIR, fileName);
    const content = await readFile(fullPath, 'utf8');
    const mock = JSON.parse(content);
    if (mock && mock.request && mock.response) {
      loadedRoutes.push(mock);
    }
  }

  routes = loadedRoutes;
  console.log(`Loaded ${loadedRoutes.length} mocks from disk`);
}

async function listMocksFromDisk() {
  await mocksInitPromise;
  const entries = await readdir(MOCKS_DIR, { withFileTypes: true });
  const files = entries.filter((entry) => entry.isFile() && entry.name.endsWith('.json')).map((entry) => entry.name);
  const mocks = [];
  for (const fileName of files) {
    const fullPath = path.join(MOCKS_DIR, fileName);
    const content = await readFile(fullPath, 'utf8');
    const mock = JSON.parse(content);
    mocks.push({
      name: fileName.replace(/\.json$/, ''),
      fileName,
      mock,
    });
  }
  return mocks;
}

async function listDebugEntries() {
  await debugStatsInitPromise;
  let content = '';
  try {
    content = await readFile(DEBUG_STATS_FILE, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }

  return content
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .reverse();
}

async function initializeDebugStats() {
  await mkdir(DEBUG_STATS_DIR, { recursive: true });
  console.log(`Request debug stats enabled: ${DEBUG_STATS_FILE}`);
}

function writeDebugStat(entry) {
  debugStatsInitPromise
    .then(() => appendFile(DEBUG_STATS_FILE, `${JSON.stringify(entry)}\n`))
    .catch((error) => {
      console.error('Failed to write debug stats entry:', error.message);
    });
}

function getDebugRequestBody(reqBody) {
  const rawBody = typeof reqBody === 'string' ? reqBody : JSON.stringify(reqBody || {}, null, 2);
  if (rawBody.length <= DEBUG_BODY_MAX_LENGTH) {
    return rawBody;
  }
  return `${rawBody.slice(0, DEBUG_BODY_MAX_LENGTH)}\n...[truncated ${rawBody.length - DEBUG_BODY_MAX_LENGTH} chars]`;
}

function shouldSkipDebugStat(reqUrl) {
  const internalPaths = [
    '/dashboard',
    '/favicon.ico',
    '/robots.txt',
    '/apple-touch-icon.png',
    '/apple-touch-icon-precomposed.png',
  ];

  if (internalPaths.includes(reqUrl)) {
    return true;
  }

  if (reqUrl.startsWith(`${MOCK_PATH}/`)) {
    return true;
  }

  return false;
}

/*
Structure of route:

{
  request: {
    match: ''
    bodyMatch: ''
  },
  response: {
    status: 200,
    body: { ... },
  }
}

*/

app.use(cors({ origin: '*' }));
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.text({ limit: '50mb', type: '*/*' }));
debugStatsInitPromise = initializeDebugStats();
mocksInitPromise = initializeMocksDir();
loadMocksFromDisk().catch((error) => {
  console.error('Failed to load mocks from disk:', error.message);
});

const smtpServer = new SMTPServer({
  authOptional: true,
  onData: async (stream, _session, callback) => {
    console.log('Got mail');
    const mail = await streamToString(stream);

    if (nextMailListeners.length) {
      console.log('Notifying mail listeners', nextMailListeners.length);
      nextMailListeners.forEach((listener) => listener(mail));
      nextMailListeners = [];
    } else {
      console.log('Adding mail to queue');
      mails.push(mail);
    }

    callback();
  },
  onAuth: (_auth, _session, cb) => {
    console.log('Mail auth');
    cb(null, { user: 'dummy' });
  },
});

smtpServer.listen(SMTP_PORT, HOST);

const route = express.Router();
app.use(MOCK_PATH, route);

app.get('/dashboard', (_req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(dashboardHtml.replace("window.__MOCK_PATH__ || '/mock'", JSON.stringify(MOCK_PATH)));
});

const streamToString = (readStream) =>
  new Promise((res) => {
    const chunks = [];
    readStream.on('data', (chunk) => chunks.push(chunk));
    readStream.on('end', () => res(Buffer.concat(chunks)));
  });

route.post('/mock', (req, res) => {
  console.log(`Mocking route:`, req.body);
  routes = routes.filter(
    (route) => !(route.request.match === req.body.request.match && route.request.bodyMatch === req.body.request.bodyMatch),
  );
  routes.push(req.body);
  res.sendStatus(204);
});

route.get('/dashboard', (_req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(dashboardHtml.replace("window.__MOCK_PATH__ || '/mock'", JSON.stringify(MOCK_PATH)));
});

route.get('/dashboard/mocks', async (_req, res) => {
  try {
    const mocks = await listMocksFromDisk();
    res.send(mocks);
  } catch (error) {
    res.status(500).send({ error: error.message });
  }
});

route.get('/dashboard/debug-entries', async (_req, res) => {
  try {
    const entries = await listDebugEntries();
    res.send(entries);
  } catch (error) {
    res.status(500).send({ error: error.message });
  }
});

route.post('/dashboard/mocks', async (req, res) => {
  try {
    const { name, mock } = req.body || {};
    if (!name || !mock?.request?.match || !mock?.response) {
      res.status(400).send({ error: 'name, mock.request.match and mock.response are required' });
      return;
    }

    const normalizedMock = {
      request: {
        method: mock.request.method || undefined,
        match: mock.request.match,
        bodyMatch: mock.request.bodyMatch || undefined,
      },
      response: {
        status: mock.response.status || 200,
        body: mock.response.body,
        contentType: mock.response.contentType,
      },
    };

    const filePath = getMockFilePath(name);
    await writeFile(filePath, `${JSON.stringify(normalizedMock, null, 2)}\n`, 'utf8');
    await loadMocksFromDisk();
    res.status(201).send({ filePath, mock: normalizedMock });
  } catch (error) {
    res.status(500).send({ error: error.message });
  }
});

route.post('/reset', (_req, res) => {
  console.log('resetting');
  routes = [];
  calls = [];
  nextCallListeners = [];
  mails = [];
  nextMailListeners = [];
  res.sendStatus(204);
});

route.post('/reset/calls', (_req, res) => {
  console.log('resetting calls');
  calls = [];
  nextCallListeners = [];
  mails = [];
  nextMailListeners = [];
  res.sendStatus(204);
});

route.post('/recordings', (req, res) => {
  console.log('Setting up recordings... info:', req.body);
  const body = req.body || {};
  recordingsContext.active = body.active || false;
  recordingsContext.deleteBodyAttributesForHash = body.deleteBodyAttributesForHash || [];
  recordingsContext.forwardHeadersForRoute = body.forwardHeadersForRoute || [];
  recordingsContext.recordings = body.recordings || {};
  recordingsContext.deleteHeadersForHash = body.deleteHeadersForHash || [];
  recordingsContext.failedRequestsResponse = body.failedRequestsResponse;
  res.sendStatus(204);
});

route.get('/recordings', (_, res) => {
  console.log('Getting recordings');
  res.send(recordingsContext.recordings);
});

route.post('/recordings/rehash', (_req, res) => {
  console.log('Rehashing recordings');
  const newRecordings = {};

  Object.values(recordingsContext.recordings)
    .flat()
    .forEach((recording) => {
      const hash = recording.request.headers['x-mock-hash'] || getShaFromData(recording.request);
      if (!newRecordings[hash]) {
        newRecordings[hash] = [];
      }
      newRecordings[hash].push(recording);
    });

  recordingsContext.recordings = newRecordings;
  res.send(recordingsContext.recordings);
});

route.get('/calls', (_req, res) => {
  res.send(calls);
});

route.get('/calls/next', (_req, res) => {
  if (calls.length) {
    console.log('sending a call');
    res.send(calls.shift());
  } else {
    console.log('registering a call listener');
    nextCallListeners.push((call) => res.send(call));
  }
});

route.get('/mails', (_req, res) => {
  res.send(mails);
});

route.get('/mails/next', (_req, res) => {
  if (mails.length) {
    console.log('sending a mail');
    res.send(mails.shift());
  } else {
    console.log('registering a mail listener', nextMailListeners.length);
    nextMailListeners.push((mail) => res.send(mail));
  }
});

route.get('/routes', (_req, res) => {
  res.send(routes);
});

function getShaFromData(data) {
  return crypto.createHash('sha512').update(JSON.stringify(data)).digest('hex');
}

function deleteNestedProperty(obj, path) {
  try {
    const keys = path.split('.');
    const lastKey = keys.pop();
    const lastObj = keys.reduce((acc, key) => acc && acc[key], obj);

    if (lastObj && lastKey in lastObj) {
      delete lastObj[lastKey];
    }
  } catch {
    console.log('Attribute not found, with path:', path);
  }
}

app.all('/*splat', async (req, res) => {
  const skipDebugStat = shouldSkipDebugStat(req.url);
  const debugRequestBody = getDebugRequestBody(req.body);
  const requestId = crypto.randomUUID();
  const debugBase = {
    timestamp: new Date().toISOString(),
    requestId,
    method: req.method,
    url: req.url,
  };
  const call = {
    method: req.method,
    headers: req.headers,
    url: req.url,
    body: req.body || {},
  };
  if (nextCallListeners.length) {
    nextCallListeners.forEach((listener) => listener(call));
    nextCallListeners = [];
  } else {
    calls.push(call);
  }

  const stringifiedBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {}, null, 2);
  const urlMatchedButBodyMismatched = [];
  for (const route of routes) {
    const methodMatched = !route.request.method || route.request.method === req.method;
    const urlMatched = new RegExp(`^${route.request.match}$`).test(req.url);
    const bodyMatched = !route.request.bodyMatch || new RegExp(`^${route.request.bodyMatch}$`, 's').test(stringifiedBody);
    if (methodMatched && urlMatched && bodyMatched) {
      console.log(`Call to ${req.url} matched ${route.request.match} ${route.request.bodyMatch || ''}`);
      const response = route.response;
      res.status(typeof response.status === 'string' ? parseInt(response.status, 10) : response.status || 200);
      res.setHeader('Content-Type', response.contentType || 'application/json');
      const body = response.bodies ? response.bodies.shift() : response.body;
      res.send(response.contentType ? body : JSON.stringify(body));
      if (!skipDebugStat) {
        writeDebugStat({
          ...debugBase,
          mockHit: true,
          source: 'routes',
          reason: 'url_and_body_match',
          details: {
            routeMatch: route.request.match,
            routeBodyMatch: route.request.bodyMatch || null,
            requestBody: debugRequestBody,
          },
        });
      }
      if (response.bodies && response.bodies.length === 0) {
        routes = routes.filter((r) => r !== nm, route);
      }

      return;
    }
    if (urlMatched && !bodyMatched) {
      urlMatchedButBodyMismatched.push({
        routeMatch: route.request.match,
        routeBodyMatch: route.request.bodyMatch || null,
      });
    }
  }

  const obfuscatedReqBodyForHash = JSON.parse(JSON.stringify(req.body || {}));
  recordingsContext.deleteBodyAttributesForHash.forEach((path) => {
    deleteNestedProperty(obfuscatedReqBodyForHash, path);
  });

  const [_, host, ...routeParts] = req.url.split('/');

  const headers = {
    ...req.headers,
    ...(recordingsContext.forwardHeadersForRoute
      // sort longest route first
      .sort((a, b) => b.route.length - a.route.length)
      .find((forwardHeaders) => req.url.startsWith(forwardHeaders.route))?.headers || {}),
  };

  const dataToHash = {
    url: req.url,
    body: obfuscatedReqBodyForHash,
    method: req.method,
    headers: {
      ...headers,
      // since host can be different based on environment, we need to remove it from the hash
      host: '',
    },
  };

  recordingsContext.deleteHeadersForHash.forEach((header) => {
    delete dataToHash.headers[header];
  });

  const hash = req.headers['x-mock-hash'] || getShaFromData(dataToHash);

  if (recordingsContext.active) {
    try {
      const route = `/${routeParts.join('/')}`;
      const targetUrl = `https://${host}${route}`;
      console.log('Proxying from ', req.url, ' to', targetUrl, ' body: ', req.body);
      const start = Date.now();
      const proxyRes = await fetch(targetUrl, {
        method: req.method,
        headers: { ...headers, 'Access-Control-Allow-Origin': '*' },
        ...(req.method !== 'GET' && req.method !== 'HEAD' && req.body ? { body: JSON.stringify(req.body) } : {}),
      });
      const status = proxyRes.status;

      res.status(status);
      const contentType = proxyRes.headers.get('content-type');
      let body;
      if (contentType && contentType.includes('application/json')) {
        body = await proxyRes.json();
        res.setHeader('Content-Type', 'application/json');
        res.json(body);
      } else {
        body = await proxyRes.text();
        res.send(body);
      }
      const durationMs = Date.now() - start;

      if (!recordingsContext.recordings[hash]) {
        recordingsContext.recordings[hash] = [];
      }
      recordingsContext.recordings[hash].push({
        body,
        status,
        request: dataToHash,
        durationMs,
      });
      if (!skipDebugStat) {
        writeDebugStat({
          ...debugBase,
          mockHit: false,
          source: 'recordings',
          reason: 'recordings_active_proxy_success',
          details: {
            hash,
            targetUrl,
            status,
            urlMatchedButBodyMismatched,
            requestBody: debugRequestBody,
          },
        });
      }
    } catch (e) {
      console.log({
        error: e.message + ' ' + req.method,
        url: req.url,
      });
      if (!skipDebugStat) {
        writeDebugStat({
          ...debugBase,
          mockHit: false,
          source: 'recordings',
          reason: 'recordings_active_proxy_failed',
          details: {
            hash,
            error: e.message,
            urlMatchedButBodyMismatched,
            requestBody: debugRequestBody,
          },
        });
      }
    }
    return;
  }

  const responseFromHash = recordingsContext.recordings[hash]?.shift();
  if (responseFromHash) {
    const { body, status, durationMs } = responseFromHash;
    if (typeof durationMs === 'number' && durationMs > 0) {
      await new Promise((r) => setTimeout(r, durationMs));
    }
    res.status(typeof status === 'string' ? parseInt(status, 10) : status);
    if (typeof body === 'object') {
      res.setHeader('Content-Type', 'application/json');
      res.send(body);
    } else {
      try {
        res.setHeader('Content-Type', 'application/json');
        res.send(JSON.parse(body));
      } catch {
        res.send(body);
      }
    }
    if (!skipDebugStat) {
      writeDebugStat({
        ...debugBase,
        mockHit: true,
        source: 'recordings',
        reason: 'recording_hash_match',
        details: {
          hash,
          status,
          requestBody: debugRequestBody,
        },
      });
    }
    return;
  }

  if (!!recordingsContext.failedRequestsResponse) {
    console.error({
      error: {
        routes: `Request ${req.url} didn't match any registered route. ${JSON.stringify(req.url, null, 2)}`,
        recordings: `Hash ${hash} didn't match any recordings. Request data: ${JSON.stringify(dataToHash, null, 2)}`,
      },
    });
    if (!skipDebugStat) {
      writeDebugStat({
        ...debugBase,
        mockHit: false,
        source: 'none',
        reason: 'no_route_or_recording_match',
        details: {
          hash,
          routesConfigured: routes.length,
          urlMatchedButBodyMismatched,
          failedRequestsResponseConfigured: true,
          requestBody: debugRequestBody,
        },
      });
    }

    res.status(200).send(recordingsContext.failedRequestsResponse);
    return;
  }
  if (!skipDebugStat) {
    writeDebugStat({
      ...debugBase,
      mockHit: false,
      source: 'none',
      reason: 'no_route_or_recording_match',
      details: {
        hash,
        routesConfigured: routes.length,
        urlMatchedButBodyMismatched,
        failedRequestsResponseConfigured: false,
        requestBody: debugRequestBody,
      },
    });
  }
  res.status(400).send({
    error: {
      routes: `Request ${req.url} didn't match any registered route. ${JSON.stringify(req.url, null, 2)}`,
      recordings: `Hash ${hash} didn't match any recordings. Request data: ${JSON.stringify(dataToHash, null, 2)}`,
    },
    url: req.url,
  });
});

http.createServer(app).listen(HTTP_PORT, HOST, () => console.log(`Smart mockserver running at ${HOST}:${HTTP_PORT} [HTTP]`));
if (HTTPS_PORT) {
  https
    .createServer({ key: readFileSync('cert/localhost.key'), cert: readFileSync('cert/localhost.crt') }, app)
    .listen(HTTPS_PORT, HOST, () => console.log(`Smart mockserver running at ${HOST}:${HTTPS_PORT} [HTTPS]`));
}
