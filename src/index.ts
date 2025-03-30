// this import must be called before the first import of tsyringe
import 'reflect-metadata';
import { performance } from 'node:perf_hooks';
import { createServer } from 'node:http';
import { createTerminus } from '@godaddy/terminus';
import { Logger } from '@map-colonies/js-logger';
import { container } from 'tsyringe';
import config from 'config';
import { DEFAULT_SERVER_PORT, MILLISECONDS_IN_SECOND, SERVICES } from '@common/constants';

import { getApp } from './app';

const port: number = config.get<number>('server.port') || DEFAULT_SERVER_PORT;
const TIME_PRECISION = 2;

void getApp()
  .then(([app]) => {
    const logger = container.resolve<Logger>(SERVICES.LOGGER);
    const stubHealthCheck = async (): Promise<void> => Promise.resolve();
    const server = createTerminus(createServer(app), { healthChecks: { '/liveness': stubHealthCheck, onSignal: container.resolve('onSignal') } });

    const isStaticAssetsEnabled = config.get<boolean>('server.staticAssets.enabled');
    const apiPrefix = config.get<string>('server.apiPrefix');

    server.listen(port, () => {
      logger.info(
        `app started in ${(performance.now() / MILLISECONDS_IN_SECOND).toFixed(TIME_PRECISION)} seconds, on port ${port} with api prefix ${apiPrefix} and static assets ${isStaticAssetsEnabled ? 'enabled' : 'disabled'}`
      );
    });
  })
  .catch((error: Error) => {
    console.error('😢 - failed initializing the server');
    console.error(error);
    process.exit(1);
  });
