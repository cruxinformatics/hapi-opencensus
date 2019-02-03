# hapi-opencensus

A hapi plugin for reporting commonly needed custom metrics. Useful for clients using stackdriver.

install
=====

```
npm install hapi-opencensus
```

usage 
=====

The following is an example of how to use this plugin with stackdriver.

```javascript
const hapiOpencensus = require('hapi-opencensus');
const { Stats } = require('@opencensus/core');
const { StackdriverStatsExporter } = require('@opencensus/exporter-stackdriver');

async function startServer() {}
  const stats = new Stats();

  // The gcp project id associated with client's stackdriver
  const projectId = process.env.GCLOUD_PROJECT;

  const exporter = new StackdriverStatsExporter({ projectId });

  stats.registerExporter(exporter);

  const server = new Hapi.Server();

  await server.register({
    plugin: hapiOpencensus,
    options: { stats },
  });

  await server.start();
}
```

### options

* stats (required): instance of opencensus `Stats` object. Should register exporter prior to initializing plugin.