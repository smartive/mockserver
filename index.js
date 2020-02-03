const express = require("express");
const bodyParser = require("body-parser");

const app = express();

let routes = [];
let calls = [];
let nextCallListeners = [];

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

app.use(bodyParser.json());
app.use(bodyParser.text())

const route = express.Router();
app.use(process.env.MOCK_PATH || "/mock", route);

route.post("/mock", (req, res) => {
  console.log(`Mocking route:`, req.body);
  routes = routes.filter(
    route => route.request.match !== req.body.request.match
  );
  routes.push(req.body);
  res.sendStatus(204);
});

route.post("/reset", (_req, res) => {
  console.log("resetting");
  routes = [];
  calls = [];
  nextCallListeners = [];
  res.sendStatus(204);
});

route.post("/reset/calls", (_req, res) => {
  console.log("resetting calls");
  calls = [];
  nextCallListeners = [];
  res.sendStatus(204);
});

route.get("/calls", (_req, res) => {
  res.send(calls);
});

route.get("/calls/next", (_req, res) => {
  if (calls.length) {
    console.log("sending a call");
    res.send(calls.shift());
  } else {
    console.log("registering a call listener");
    nextCallListeners.push(call => res.send(call));
  }
});

route.get("/routes", (_req, res) => {
  res.send(routes);
});

app.all("*", (req, res) => {
  const call = {
    method: req.method,
    headers: req.headers,
    url: req.url,
    body: req.body
  };
  if (nextCallListeners.length) {
    nextCallListeners.forEach(listener => listener(call));
    nextCallListeners = [];
  } else {
    calls.push(call);
  }

  for (const route of routes) {
    if (new RegExp(`^${route.request.match}$`).test(req.url)) {
      console.log(`Call to ${req.url} matched ${route.request.match}`);
      res.status(route.response.status);
      res.setHeader(
        "Content-Type",
        route.response.contentType || "application/json"
      );
      res.send(
        route.response.contentType
          ? route.response.body
          : JSON.stringify(route.response.body)
      );

      return;
    }
  }

  const errorMessage = `Request ${req.url} didn't match any registered route.`;
  console.log(errorMessage, routes);

  res.status(400).send({
    error: errorMessage,
    url: req.url
  });
});

const port = process.env.PORT || "1080";
const host = process.env.HOST || "0.0.0.0";
app.listen(port, host, () =>
  console.log(`Smart mockserver running at ${host}:${port}`)
);
