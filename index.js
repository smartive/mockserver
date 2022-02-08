const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const { SMTPServer } = require('smtp-server');

const app = express();
const http = require('http');
const https = require('https');
const { readFileSync } = require('fs');

const HTTP_PORT = process.env.PORT || 1080;
const HTTPS_PORT = process.env.HTTPS_PORT;
const SMTP_PORT = process.env.SMTP_PORT || '25';
const HOST = process.env.HOST || '0.0.0.0';

let routes = [];
let calls = [];
let nextCallListeners = [];
let mails = [];
let nextMailListeners = [];

/*
Structure of route:

{
  request: {
    match: ''
  },
  response: {
    status: 200,
    body: { ... },
  }
}

*/

app.use(cors({ origin: '*' }));
app.use(bodyParser.json());
app.use(bodyParser.text());

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
app.use(process.env.MOCK_PATH || '/mock', route);

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

app.all('*', (req, res) => {
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

  const stringifiedBody = JSON.stringify(req.body, null, 2);
  for (const route of routes) {
    if (
      new RegExp(`^${route.request.match}$`).test(req.url) &&
      (!route.request.bodyMatch || new RegExp(`^${route.request.bodyMatch}$`, 'm').test(stringifiedBody))
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

  const errorMessage = `Request ${req.url} didn't match any registered route.`;

  res.status(400).send({
    error: errorMessage,
    url: req.url,
  });
});

http.createServer(app).listen(HTTP_PORT, HOST, () => console.log(`Smart mockserver running at ${HOST}:${HTTP_PORT}`));
if (HTTPS_PORT) {
  https
    .createServer({ key: readFileSync('cert/localhost.key'), cert: readFileSync('cert/localhost.crt') }, app)
    .listen(HTTPS_PORT, HOST, () => console.log(`Smart mockserver running at ${HOST}:${HTTPS_PORT}`));
}
