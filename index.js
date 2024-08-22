const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const { SMTPServer } = require('smtp-server');

const app = express();
const http = require('http');
const https = require('https');
const { readFileSync } = require('fs');

const HTTP_PORT = process.env.MOCK_HTTP_PORT || process.env.PORT || 1080;
const HTTPS_PORT = process.env.MOCK_HTTPS_PORT || process.env.HTTPS_PORT;
const SMTP_PORT = process.env.MOCK_SMTP_PORT || process.env.SMTP_PORT || '25';
const HOST = process.env.MOCK_HOST || process.env.HOST || '0.0.0.0';
const MOCK_PATH = process.env.MOCK_PATH || '/mock';

let routes = [];
let calls = [];
let nextCallListeners = [];
let mails = [];
let nextMailListeners = [];
let recordingsContext = {
  active: false,
  namespace: '',
  deleteBodyAttributes: [],
};
let recordings = {};

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

const streamToString = (readStream) =>
  new Promise((res) => {
    const chunks = [];
    readStream.on('data', (chunk) => chunks.push(chunk));
    readStream.on('end', () => res(Buffer.concat(chunks)));
  });

route.post('/mock', (req, res) => {
  console.log(`Mocking route:`, req.body);
  routes = routes.filter(
    (route) => !(route.request.match === req.body.request.match && route.request.bodyMatch === req.body.request.bodyMatch)
  );
  routes.push(req.body);
  res.sendStatus(204);
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

route.post('/record', (req, res) => {
  console.log('Setting up recordings... info:', req.body);
  recordingsContext.active = req.body.active || false;
  recordingsContext.namespace = req.body.namespace || '';
  recordingsContext.deleteBodyAttributes = req.body.deleteBodyAttributes || [];
  res.sendStatus(204);
});

route.post('/load-recordings', (req, res) => {
  console.log('Loading recordings');
  recordings = req.body;
  res.sendStatus(204);
});

route.get('/recordings', (_, res) => {
  console.log('Getting recordings');
  res.send(recordings);
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

app.all('*', async (req, res) => {
  const call = {
    method: req.method,
    headers: req.headers,
    url: req.url,
    body: req.body,
  };
  if (nextCallListeners.length) {
    nextCallListeners.forEach((listener) => listener(call));
    nextCallListeners = [];
  } else {
    calls.push(call);
  }

  const stringifiedBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body, null, 2);
  for (const route of routes) {
    if (
      new RegExp(`^${route.request.match}$`).test(req.url) &&
      (!route.request.bodyMatch || new RegExp(`^${route.request.bodyMatch}$`, 's').test(stringifiedBody))
    ) {
      console.log(`Call to ${req.url} matched ${route.request.match} ${route.request.bodyMatch || ''}`);
      const response = route.response;
      res.status(response.status || 200);
      res.setHeader('Content-Type', response.contentType || 'application/json');
      const body = response.bodies ? response.bodies.shift() : response.body;
      res.send(response.contentType ? body : JSON.stringify(body));
      if (response.bodies && response.bodies.length === 0) {
        routes = routes.filter((r) => r !== nm, route);
      }

      return;
    }
  }

  const obfuscatedBody = JSON.parse(JSON.stringify(req.body));
  recordingsContext.deleteBodyAttributes.forEach((attr) => {
    try {
      console.log('Deleting attribute', attr);
      eval(`delete obfuscatedBody.${attr}`);
    } catch {
      console.log('No attribute to delete: ', attr);
    }
  });
  const dataToHash = {
    url: req.url,
    body: obfuscatedBody,
    method: req.method,
    headers: req.headers,
  };
  const crypto = require('crypto');
  const hash = crypto.createHash('sha512').update(JSON.stringify(dataToHash)).digest('hex');
  if (recordingsContext.active) {
    try {
      const host = req.url.split('/')[1];
      const route = req.url.replace(`/${host}`, '');
      const targetUrl = `https://${host}${route}`;
      console.log('Proxying from ', req.url, ' to', targetUrl);
      const proxyRes = await fetch(targetUrl, {
        method: req.method,
        headers: { ...req.headers, 'Access-Control-Allow-Origin': '*' },
        ...(req.method !== 'GET' && req.method !== 'HEAD' ? { body: JSON.stringify(req.body) } : {}),
      });
      const status = proxyRes.status;

      res.status(proxyRes.status);
      for (const [key, value] of proxyRes.headers.entries()) {
        res.setHeader(key, value);
      }
      const body = await proxyRes.text();
      if (!recordings[recordingsContext.namespace]) {
        recordings[recordingsContext.namespace] = {};
      }
      recordings[recordingsContext.namespace][hash] = {
        body,
        status,
        hashData: {
          ...dataToHash,
        },
      };

      res.status(status).send(body);
    } catch (e) {
      console.log({
        error: e.message + ' ' + req.method,
        url: req.url,
      });
    }
    return;
  }

  const responseFromHash = Object.values(recordings).find((rec) => rec[hash]);
  if (responseFromHash) {
    const { body, status } = responseFromHash[hash];
    res.setHeader('Content-Type', 'application/json');
    res.status(status).send(JSON.parse(body));
    return;
  }

  const errorMessage = `Request ${req.url} didn't match any registered route. ${JSON.stringify(req.url, null, 2)}`;

  res.status(400).send({
    error: errorMessage,
    url: req.url,
  });
});

http.createServer(app).listen(HTTP_PORT, HOST, () => console.log(`Smart mockserver running at ${HOST}:${HTTP_PORT} [HTTP]`));
if (HTTPS_PORT) {
  https
    .createServer({ key: readFileSync('cert/localhost.key'), cert: readFileSync('cert/localhost.crt') }, app)
    .listen(HTTPS_PORT, HOST, () => console.log(`Smart mockserver running at ${HOST}:${HTTPS_PORT} [HTTPS]`));
}
