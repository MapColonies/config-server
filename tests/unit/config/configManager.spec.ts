import jsLogger, { Logger } from '@map-colonies/js-logger';
import { ConfigManager } from '../../../src/configs/models/configManager';
import { ConfigRefResponse, ConfigRepository } from '../../../src/configs/repositories/configRepository';
import { Validator } from '../../../src/configs/models/configValidator';
import {
  ConfigNotFoundError,
  ConfigVersionMismatchError,
  ConfigValidationError,
  ConfigSchemaMismatchError,
} from '../../../src/configs/models/errors';

describe('ConfigManager', () => {
  let configManager: ConfigManager;
  let configRepository: ConfigRepository;
  let configValidator: Validator;
  let logger: Logger;

  beforeEach(() => {
    logger = jsLogger({ enabled: false });
    configRepository = {} as ConfigRepository;
    configValidator = {} as Validator;
    configManager = new ConfigManager(logger, configRepository, configValidator);
  });

  afterEach(() => {
    jest.clearAllMocks();
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

    it('should return the config with it being dereferenced', async () => {
      // @ts-expect-error ts wants this to be a predicate
      configValidator.validateRef = jest.fn().mockResolvedValue(true);
      const config = {
        config: { avi: { $ref: { configName: 'refName', version: 1 } } },
      };
      const refs: ConfigRefResponse[] = [{ config: { test: 'test' }, configName: 'refName', version: 1, isLatest: false }];
      configRepository.getConfigRecursive = jest.fn().mockResolvedValue([config, refs]);

      const result = await configManager.getConfig('configName', 1, true);

      expect(result).toStrictEqual({ ...config, config: { avi: { test: 'test' } } });
    });

    it('should return the config with it being dereferenced when the ref is in the root of the object', async () => {
      // @ts-expect-error ts wants this to be a predicate
      configValidator.validateRef = jest.fn().mockResolvedValue(true);
      const config = {
        config: { $ref: { configName: 'refName', version: 1 } },
      };
      const refs: ConfigRefResponse[] = [{ config: { test: 'test' }, configName: 'refName', version: 1, isLatest: false }];
      configRepository.getConfigRecursive = jest.fn().mockResolvedValue([config, refs]);

      const result = await configManager.getConfig('configName', 1, true);

      expect(result).toStrictEqual({ ...config, config: { test: 'test' } });
    });

    it('should throw ConfigNotFoundError when the config does not exist', async () => {
      configRepository.getConfig = jest.fn().mockResolvedValue(null);

      await expect(configManager.getConfig('configName')).rejects.toThrow(ConfigNotFoundError);
    });

    it('should throw ConfigNotFoundError when the config does not exist and dereference config is true', async () => {
      configRepository.getConfigRecursive = jest.fn().mockResolvedValue(null);

      await expect(configManager.getConfig('configName', 1, true)).rejects.toThrow(ConfigNotFoundError);
    });
  });

  describe('getConfigs', () => {
    it('should return the list of configs', async () => {
      const options: Parameters<typeof configManager.getConfigs>[0] = {
        /* eslint-disable @typescript-eslint/naming-convention */
        created_at_gt: '2021-01-01T00:00:00Z',
        created_at_lt: '2021-01-02T00:00:00Z',
        sort: [{ field: 'configName', order: 'asc' }],
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
        {},
        [{ field: 'configName', order: 'asc' }]
      );
    });
  });

  describe('createConfig', () => {
    it('should create a new config', async () => {
      const config = { configName: 'avi', schemaId: 'https://mapcolonies.com/test/v1', config: {}, version: 1 };
      configRepository.getConfig = jest.fn().mockResolvedValue(undefined);
      configRepository.getAllConfigRefs = jest.fn().mockResolvedValue([]);
      configValidator.isValid = jest.fn().mockResolvedValue([true, null]);
      configRepository.createConfig = jest.fn();

      await configManager.createConfig({ ...config });

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(configRepository.createConfig).toHaveBeenCalledWith({ ...config, createdBy: 'TBD', refs: [] });
    });

    it('should increment the version when a new version is created', async () => {
      const config = { configName: 'avi', schemaId: 'https://mapcolonies.com/test/v1', config: {}, version: 1 };
      configRepository.getConfig = jest.fn().mockResolvedValue({ version: 1, schemaId: config.schemaId });
      configValidator.isValid = jest.fn().mockResolvedValue([true, null]);
      configRepository.getAllConfigRefs = jest.fn().mockResolvedValue([]);
      configRepository.createConfig = jest.fn();

      await configManager.createConfig({ ...config });

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(configRepository.createConfig).toHaveBeenCalledWith({ ...config, version: 2, createdBy: 'TBD', refs: [] });
    });

    it('should create a new config with refs', async () => {
      const config = {
        configName: 'avi',
        schemaId: 'https://mapcolonies.com/test/v1',
        config: { avi: { $ref: { configName: 'refName', version: 'latest' } } },
        version: 1,
      };
      const refs: ConfigRefResponse[] = [{ configName: 'refName', version: 1, isLatest: true, config: { test: 'test' } }];
      configRepository.getConfig = jest.fn().mockResolvedValue(undefined);
      configValidator.isValid = jest.fn().mockResolvedValue([true, null]);
      configRepository.getAllConfigRefs = jest.fn().mockResolvedValue(refs);
      configRepository.createConfig = jest.fn();
      // @ts-expect-error ts wants this to be a predicate
      configValidator.validateRef = jest.fn().mockReturnValue(true);

      await configManager.createConfig({ ...config });

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(configRepository.createConfig).toHaveBeenCalledWith({
        ...config,
        createdBy: 'TBD',
        refs: [{ configName: 'refName', version: 'latest' }],
      });
    });

    it('should throw ConfigVersionMismatchError when the version is not the next one in line', async () => {
      const config = { configName: 'avi', schemaId: 'https://mapcolonies.com/test/v1', config: {}, version: 1 };
      configRepository.getConfig = jest.fn().mockResolvedValue({ version: 2, schemaId: config.schemaId });

      await expect(configManager.createConfig(config)).rejects.toThrow(ConfigVersionMismatchError);
    });

    it('should throw ConfigVersionMismatchError when a new version is created, but no version exists', async () => {
      const config = { configName: 'avi', schemaId: 'https://mapcolonies.com/test/v1', config: {}, version: 2 };
      configRepository.getConfig = jest.fn().mockResolvedValue(undefined);

      await expect(configManager.createConfig(config)).rejects.toThrow(ConfigVersionMismatchError);
    });

    it('should throw ConfigValidationError when the config is not valid', async () => {
      const config = { configName: 'avi', schemaId: 'https://mapcolonies.com/test/v1', config: {}, version: 1 };
      configRepository.getConfig = jest.fn().mockResolvedValue({ version: 1, schemaId: config.schemaId });
      configValidator.isValid = jest.fn().mockResolvedValue([false, 'Validation error']);
      configRepository.getAllConfigRefs = jest.fn().mockResolvedValue([]);

      await expect(configManager.createConfig(config)).rejects.toThrow(ConfigValidationError);
    });

    it('should throw ConfigValidationError when the reference is not valid', async () => {
      const config = {
        configName: 'avi',
        schemaId: 'https://mapcolonies.com/test/v1',
        config: { avi: { $ref: { configName: 'refName' } } },
        version: 1,
      };
      configRepository.getConfig = jest.fn().mockResolvedValue(undefined);
      configValidator.isValid = jest.fn().mockResolvedValue([true, null]);
      configRepository.getAllConfigRefs = jest.fn().mockResolvedValue([]);
      // @ts-expect-error ts wants this to be a predicate
      configValidator.validateRef = jest.fn().mockReturnValue(false);

      await expect(configManager.createConfig(config)).rejects.toThrow(ConfigValidationError);
    });

    it('should throw ConfigSchemaMismatchError when the schema does not match the last entry', async () => {
      const config = { configName: 'avi', schemaId: 'https://mapcolonies.com/test/v1', config: {}, version: 1 };
      configRepository.getConfig = jest.fn().mockResolvedValue({ version: 1, schemaId: 'https://mapcolonies.com/test/v2' });

      await expect(configManager.createConfig(config)).rejects.toThrow(ConfigSchemaMismatchError);
    });
  });
});
