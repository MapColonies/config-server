import type { Application } from 'express';
import type { DependencyContainer } from 'tsyringe';
import type { Logger } from '@map-colonies/js-logger';
import { SERVICES } from '@common/constants';
import { registerExternalValues, type RegisterOptions } from './containerConfig';
import { ServerBuilder } from './serverBuilder';
import { ConfigManager } from './configs/models/configManager';

async function getApp(registerOptions?: RegisterOptions): Promise<[Application, DependencyContainer]> {
  const container = await registerExternalValues(registerOptions);
  const configManager = container.resolve(ConfigManager);
  const logger = container.resolve<Logger>(SERVICES.LOGGER);
  try {
    await configManager.insertDefaultConfigs();
  } catch (err) {
    logger.warn({ msg: 'Failed to insert default configs', err });
  }

  const app = container.resolve(ServerBuilder).build();
  return [app, container];
}

export { getApp };
