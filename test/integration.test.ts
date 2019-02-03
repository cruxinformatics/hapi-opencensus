import ava from 'ava';
import * as Hapi from 'hapi';
import boom from 'boom';
import events from 'events';
import { Stats } from '@opencensus/core';
import { StackdriverStatsExporter, TimeSeries } from '@opencensus/exporter-stackdriver';
import assert from 'assert';
import index from '../src/index';

const projectId = process.env.PROJECT_ID;

assert.equal(
  typeof projectId,
  'string',
  'Please set environment variable PROJECT_ID to the gcp project id.',
);

ava('Emits stats to route views.', async (t) => {
  t.timeout(180000);

  const eventEmitter = new events();
  const timeSeriesPromise: Promise<TimeSeries[]> = new Promise(resolve =>
    eventEmitter.on('time-series', timeSeriesLog => resolve(timeSeriesLog)));

  let recorded = false;
  function log() {
    if (!recorded && arguments[0] && arguments[0].indexOf('sent time series') !== -1) {
      eventEmitter.emit('time-series', arguments[1]);
      recorded = true;
    }
  }

  const stats = new Stats();

  const logger = {
    debug: log,
    error: log,
    trace: log,
    info: log,
    warn: log,
    silly: log,
    level: 'trace',
  };

  const exporter = new StackdriverStatsExporter({ projectId, logger });

  stats.registerExporter(exporter);
  const server = new Hapi.Server();

  server.route({
    method: 'GET',
    path: '/test/{status}',
    handler(request) {
      if (request.params.status === 'success') {
        return 'ok';
      }

      return boom.badImplementation('mock failure');
    },
  });

  await server.register({
    plugin: index,
    options: { stats },
  });

  await server.start();

  await server.inject('/test/success');
  await server.inject('/test/failure');

  const timeSeriesLog = await timeSeriesPromise;

  const loggedResponseTimesCount = timeSeriesLog[0]
    .points[0]
    .value
    .distributionValue
    .bucketCounts.reduce((sum, count) => sum + count);

  t.deepEqual(loggedResponseTimesCount, 2, 'Emmitted response time stats for each request.');

  const twoHundredResponseCount = timeSeriesLog[1]
    .points[0]
    .value
    .distributionValue
    .bucketCounts[3];

  t.deepEqual(twoHundredResponseCount, 1, 'Emmitted one 2xx status.');

  const fiveHundredResponseCount = timeSeriesLog[1]
    .points[0]
    .value
    .distributionValue
    .bucketCounts[6];

  t.deepEqual(fiveHundredResponseCount, 1, 'Emmitted one 5xx status.');

  t.pass('Stackdriver has logged message indicating that stats have been sent.');
});
