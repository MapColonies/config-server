import 'jest-extended';
import 'jest-openapi';
import 'jest-sorted';

import { describe, beforeAll, it, expect } from 'vitest';
import { jsLogger } from '@map-colonies/js-logger';
import { DependencyContainer } from 'tsyringe';
import { getApp } from '@src/app';
import { ConfigManager } from '@src/configs/models/configManager';
import { SERVICES } from '@common/constants';

describe('Default Configs', function () {
  let dependencyContainer: DependencyContainer;
  beforeAll(async function () {
    const [, container] = await getApp({
      override: [{ token: SERVICES.LOGGER, provider: { useValue: jsLogger({ enabled: false }) } }],
      useChild: true,
    });
    dependencyContainer = container;
  });

  it('should insert all the default configs in the current schemas package', async function () {
    const configManager = dependencyContainer.resolve(ConfigManager);

    const action = configManager.insertDefaultConfigs();

    await expect(action).resolves.not.toThrow();
  });
});
