import hapi from 'hapi';
import assert from 'assert';
import { Stats, MeasureUnit, Measure, AggregationType } from '@opencensus/core';
import boom from 'boom';
import packageJson from '../package.json';

export interface PluginOptions {
  stats: Stats;
}

export function getMetrics(server: hapi.Server): string[] {
  return [];
}

interface MeasureMap {
  [path: string]: Measure;
}

const latencyBuckets = [0, 1, 2, 3, 4, 5, 6, 8, 10, 15, 20,
  25, 30, 40, 50, 65, 80, 100, 200, 500, 1000, 2000, 3000, 4000, 8000, 16000, 32000, 64000, 120000];

const statusBuckets = [0, 100, 200, 300, 400, 500];

interface RequestState {
  start: number;
}

interface PluginsState {
  'hapi-opencensus': RequestState;
}

function routeReference(route: hapi.RequestRoute): string {
  return `${route.method}-${route.path}`;
}

function cleanMetricPath(path: string): string {
  return path.replace(/(\{|\})/g, '_').replace(/\//g, '.');
}

export const plugin: hapi.Plugin<PluginOptions> = {
  pkg: packageJson,
  register(server: hapi.Server, { stats }: PluginOptions) {
    assert(
      typeof stats !== 'undefined',
      'Must pass an opencensus Stats instance upon initialization.',
    );

    if (!stats) {
      throw new Error('Must pass an opencensus Stats instance upon initialization.');
    }

    const latencyMeasures: MeasureMap = {};
    const statusMeasures: MeasureMap = {};

    server.ext({
      type: 'onPreStart',
      method(server) {
        server.table().forEach((r) => {
          const latencyMeasure =
            stats.createMeasureDouble(
              cleanMetricPath(`hapi-opencensus-response-time-${r.method}${r.path}`),
              MeasureUnit.MS,
              `Response time of ${r.method} ${r.path} in ms.`,
            );

          const latencyDistributionPath =
            cleanMetricPath(`hapi-opencensus-response-time-distribution-${r.method}${r.path}`);

          stats.createView(
            latencyDistributionPath,
            latencyMeasure,
            AggregationType.DISTRIBUTION,
            [],
            `Distribution of response times of ${r.method} ${r.path} in ms.`,
            latencyBuckets,
          );

          const statusMeasure =
            stats.createMeasureDouble(
              cleanMetricPath(`hapi-opencensus-status-${r.method}${r.path}`),
              MeasureUnit.UNIT,
              `Status code of ${r.method} ${r.path} response rounded to closest 100.`,
            );

          const statusDistributionPath =
            cleanMetricPath(`hapi-opencensus-status-distribution-${r.method}${r.path}`);

          stats.createView(
            statusDistributionPath,
            statusMeasure,
            AggregationType.DISTRIBUTION,
            [],
            `Distribution of response statuses of ${r.method} ${r.path} rounded to closest 100.`,
            statusBuckets,
          );

          latencyMeasures[routeReference(r)] = latencyMeasure;
          statusMeasures[routeReference(r)] = statusMeasure;
        });

      },
    });

    server.ext({
      type: 'onRequest',
      method(request, h) {
        const requestState: RequestState = { start: Date.now() };
        const pluginsState: any =  request.plugins;
        pluginsState[packageJson.name] = requestState;
        return h.continue;
      },
    });

    server.ext({
      type: 'onPreResponse',
      method(request, h) {
        const pluginsState: any = request.plugins;
        const responseTime = Date.now() - pluginsState[packageJson.name].start;

        const latencyMeasure = latencyMeasures[routeReference(request.route)];
        if (latencyMeasure) {
          stats.record({
            measure: latencyMeasure,
            tags: {},
            value: responseTime,
          });
        }

        const statusMeasure = statusMeasures[routeReference(request.route)];
        if (statusMeasure) {
          let statusCode;
          if (request.response instanceof boom) {
            const response = request.response as boom;
            statusCode = response.output.statusCode;
          } else {
            const response = request.response as hapi.ResponseObject;
            statusCode = response.statusCode;
          }
          const roundedStatus = Math.floor(statusCode / 100) * 100;

          stats.record({
            measure: statusMeasure,
            tags: {},
            value: roundedStatus,
          });
        }

        return h.continue;
      },
    });
  },
};

export default plugin;
