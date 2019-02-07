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

const latencyBuckets = [0, 1, 2, 3, 4, 5, 6, 8, 10, 13, 16, 20,
  25, 30, 40, 50, 65, 80, 100, 200, 500, 1000, 2000, 4000, 8000];

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
        server.table().forEach((route) => {
          const latencyMeasure =
            stats.createMeasureDouble(
              cleanMetricPath(`hapi-opencensus-response-time-${route.method}${route.path}`),
              MeasureUnit.MS,
              `Response time of ${route.method} ${route.path} in ms.`,
            );

          stats.createView(
            cleanMetricPath(`hapi-opencensus-response-time-distribution-${route.method}${route.path}`),
            latencyMeasure,
            AggregationType.DISTRIBUTION,
            [],
            `Distribution of response times of ${route.method} ${route.path} in ms.`,
            latencyBuckets,
          );

          const statusMeasure =
            stats.createMeasureDouble(
              cleanMetricPath(`hapi-opencensus-status-${route.method}${route.path}`),
              MeasureUnit.UNIT,
              `Status code of ${route.method} ${route.path} response rounded to closest 100.`,
            );

          stats.createView(
            cleanMetricPath(`hapi-opencensus-status-distribution-${route.method}${route.path}`),
            statusMeasure,
            AggregationType.DISTRIBUTION,
            [],
            `Distribution of response statuses of ${route.method} ${route.path} rounded to closest 100.`,
            statusBuckets,
          );

          latencyMeasures[routeReference(route)] = latencyMeasure;
          statusMeasures[routeReference(route)] = statusMeasure;
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

        stats.record({
          measure: latencyMeasures[routeReference(request.route)],
          tags: {},
          value: responseTime,
        });

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
          measure: statusMeasures[routeReference(request.route)],
          tags: {},
          value: roundedStatus,
        });

        return h.continue;
      },
    });
  },
};

export default plugin;
