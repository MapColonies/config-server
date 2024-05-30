import { Logger } from '@map-colonies/js-logger';
import { ConfigManager } from '../../../src/configs/models/configManager';
import { ConfigRepository } from '../../../src/configs/repositories/configRepository';
import { Validator } from '../../../src/configs/models/configValidator';
import { ConfigNotFoundError, ConfigVersionMismatchError, ConfigValidationError } from '../../../src/configs/models/errors';

describe('ConfigManager', () => {
  let configManager: ConfigManager;
  let configRepository: ConfigRepository;
  let configValidator: Validator;
  let logger: Logger;

  beforeEach(() => {
    logger = {} as Logger;
    configRepository = {} as ConfigRepository;
    configValidator = {} as Validator;
    configManager = new ConfigManager(logger, configRepository, configValidator);
  });

  describe('getConfig', () => {
    it('should return the config when it exists', async () => {
      const config = {
        /* mock config object */
      };
      configRepository.getConfig = jest.fn().mockResolvedValue(config);

      const result = await configManager.getConfig('configName');

      expect(result).toBe(config);
    });

    it('should throw ConfigNotFoundError when the config does not exist', async () => {
      configRepository.getConfig = jest.fn().mockResolvedValue(null);

      await expect(configManager.getConfig('configName')).rejects.toThrow(ConfigNotFoundError);
    });
  });

  describe('getConfigs', () => {
    it('should return the list of configs', async () => {
      const options: Parameters<typeof configManager.getConfigs>[0] = {
        /* eslint-disable @typescript-eslint/naming-convention */
        created_at_gt: '2021-01-01T00:00:00Z',
        created_at_lt: '2021-01-02T00:00:00Z',
        /* eslint-enable @typescript-eslint/naming-convention */
      };
      const configs = { configs: [], totalCount: 0 };
      const getConfigsMock = jest.fn().mockResolvedValue(configs);
      configRepository.getConfigs = getConfigsMock;

      const result = await configManager.getConfigs(options);

      expect(result).toBe(configs);
      expect(getConfigsMock).toHaveBeenCalledWith(
        {
          createdAtGt: new Date('2021-01-01T00:00:00Z'),
          createdAtLt: new Date('2021-01-02T00:00:00Z'),
        },
        {}
      );
    });
  });

  describe('createConfig', () => {
    it('should create a new config', async () => {
      const config = { configName: 'avi', schemaId: 'https://mapcolonies.com/test/v1', config: {}, version: 1 };
      configRepository.getConfigMaxVersion = jest.fn().mockResolvedValue(null);
      configValidator.isValid = jest.fn().mockResolvedValue([true, null]);
      configRepository.createConfig = jest.fn();

      await configManager.createConfig({...config});

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(configRepository.createConfig).toHaveBeenCalledWith({ ...config, createdBy: 'TBD' });
    });

    it('should increment the version when a new version is created', async () => {
      const config = { configName: 'avi', schemaId: 'https://mapcolonies.com/test/v1', config: {}, version: 1 };
      configRepository.getConfigMaxVersion = jest.fn().mockResolvedValue(1);
      configValidator.isValid = jest.fn().mockResolvedValue([true, null]);
      configRepository.createConfig = jest.fn();

      await configManager.createConfig({...config});

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(configRepository.createConfig).toHaveBeenCalledWith({ ...config, version: 2, createdBy: 'TBD' });
    });

    it('should throw ConfigVersionMismatchError when the version is not the next one in line', async () => {
      const config = { configName: 'avi', schemaId: 'https://mapcolonies.com/test/v1', config: {}, version: 1 };
      configRepository.getConfigMaxVersion = jest.fn().mockResolvedValue(2);

      await expect(configManager.createConfig(config)).rejects.toThrow(ConfigVersionMismatchError);
    });

    it('should throw ConfigValidationError when the config is not valid', async () => {
      const config = { configName: 'avi', schemaId: 'https://mapcolonies.com/test/v1', config: {}, version: 1 };
      configRepository.getConfigMaxVersion = jest.fn().mockResolvedValue(1);
      configValidator.isValid = jest.fn().mockResolvedValue([false, 'Validation error']);

      await expect(configManager.createConfig(config)).rejects.toThrow(ConfigValidationError);
    });
  });
});
