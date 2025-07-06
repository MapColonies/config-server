import fs, { Dirent } from 'node:fs';
import jsLogger, { Logger } from '@map-colonies/js-logger';
import { ConfigManager } from '@src/configs/models/configManager';
import { ConfigRefResponse, ConfigRepository } from '@src/configs/repositories/configRepository';
import { Validator } from '@src/configs/models/configValidator';
import { ConfigNotFoundError, ConfigVersionMismatchError, ConfigValidationError, ConfigSchemaMismatchError } from '@src/configs/models/errors';
import * as utils from '@src/common/utils';
import { ConfigReference } from '@src/configs/models/configReference';

jest.mock('../../../src/common/utils', () => {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return
  return {
    // eslint-disable-next-line @typescript-eslint/naming-convention
    __esModule: true,
    ...jest.requireActual('../../../src/common/utils'),
  };
});

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

      const result = await configManager.getConfig('configName', 'https://mapcolonies.com/test/v1');

      expect(result).toBe(config);
    });

    it('should return the config with it being dereferenced', async () => {
      // @ts-expect-error ts wants this to be a predicate
      configValidator.validateRef = jest.fn().mockResolvedValue(true);
      const config = {
        config: { avi: { $ref: { configName: 'refName', version: 1, schemaId: 'https://mapcolonies.com/test/v1' } } },
      };
      const refs: ConfigRefResponse[] = [
        { config: { test: 'test' }, configName: 'refName', version: 1, isLatest: false, schemaId: 'https://mapcolonies.com/test/v1' },
      ];
      configRepository.getConfigRecursive = jest.fn().mockResolvedValue([config, refs]);

      const result = await configManager.getConfig('configName', 'https://mapcolonies.com/test/v1', 1, true);

      expect(result).toStrictEqual({ ...config, config: { avi: { test: 'test' } } });
    });

    it('should return the config with it being dereferenced when the ref is in the root of the object', async () => {
      // @ts-expect-error ts wants this to be a predicate
      configValidator.validateRef = jest.fn().mockResolvedValue(true);
      const config = {
        config: { $ref: { configName: 'refName', version: 1, schemaId: 'https://mapcolonies.com/test/v1' } },
      };
      const refs: ConfigRefResponse[] = [
        { config: { test: 'test' }, configName: 'refName', version: 1, isLatest: false, schemaId: 'https://mapcolonies.com/test/v1' },
      ];
      configRepository.getConfigRecursive = jest.fn().mockResolvedValue([config, refs]);

      const result = await configManager.getConfig('configName', 'https://mapcolonies.com/test/v1', 1, true);

      expect(result).toStrictEqual({ ...config, config: { test: 'test' } });
    });

    it('should return the config with it being dereferenced when there is a ref in the root object and another nested one', async () => {
      // @ts-expect-error ts wants this to be a predicate
      configValidator.validateRef = jest.fn().mockResolvedValue(true);
      const config = {
        config: {
          $ref: { configName: 'refName', version: 1, schemaId: 'https://mapcolonies.com/test/v1' },
          avi: { $ref: { configName: 'refName', version: 1, schemaId: 'https://mapcolonies.com/test/v1' } },
        },
      };
      const refs: ConfigRefResponse[] = [
        { config: { test: 'test' }, configName: 'refName', version: 1, isLatest: false, schemaId: 'https://mapcolonies.com/test/v1' },
      ];
      configRepository.getConfigRecursive = jest.fn().mockResolvedValue([config, refs]);

      const result = await configManager.getConfig('configName', 'https://mapcolonies.com/test/v1', 1, true);

      expect(result).toStrictEqual({ ...config, config: { test: 'test', avi: { test: 'test' } } });
    });

    it('should throw ConfigNotFoundError when the config does not exist', async () => {
      configRepository.getConfig = jest.fn().mockResolvedValue(null);

      await expect(configManager.getConfig('configName', 'https://mapcolonies.com/test/v1')).rejects.toThrow(ConfigNotFoundError);
    });

    it('should throw ConfigNotFoundError when the config does not exist and dereference config is true', async () => {
      configRepository.getConfigRecursive = jest.fn().mockResolvedValue(null);

      await expect(configManager.getConfig('configName', 'https://mapcolonies.com/test/v1', 1, true)).rejects.toThrow(ConfigNotFoundError);
    });

    it('should throw an error is the schemaId is not provided in the ref object', async () => {
      // @ts-expect-error ts wants this to be a predicate
      configValidator.validateRef = jest.fn().mockResolvedValue(true);
      const config = {
        config: { avi: { $ref: { configName: 'refName', version: 1 } } },
      };
      const refs: ConfigRefResponse[] = [
        { config: { test: 'test' }, configName: 'refName', version: 1, isLatest: false, schemaId: 'https://mapcolonies.com/test/v1' },
      ];
      configRepository.getConfigRecursive = jest.fn().mockResolvedValue([config, refs]);

      const action = configManager.getConfig('configName', 'https://mapcolonies.com/test/v1', 1, true);

      await expect(action).rejects.toThrow('could not find ref in db');
    });

    it('should throw an error is the schemaId does not match the one in the database', async () => {
      // @ts-expect-error ts wants this to be a predicate
      configValidator.validateRef = jest.fn().mockResolvedValue(true);
      const config = {
        config: { avi: { $ref: { configName: 'refName', version: 1, schemaId: 'https://mapcolonies.com/test/v2' } } },
      };
      const refs: ConfigRefResponse[] = [
        { config: { test: 'test' }, configName: 'refName', version: 1, isLatest: false, schemaId: 'https://mapcolonies.com/test/v1' },
      ];
      configRepository.getConfigRecursive = jest.fn().mockResolvedValue([config, refs]);

      const action = configManager.getConfig('configName', 'https://mapcolonies.com/test/v1', 1, true);

      await expect(action).rejects.toThrow('could not find ref in db');
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
      configRepository.getConfigs = jest.fn().mockResolvedValue({ totalCount: 0, configs: [] });

      await configManager.createConfig({ ...config });

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(configRepository.createConfig).toHaveBeenCalledWith({ ...config, createdBy: 'TBD', refs: [] });
    });

    it('should create a new config with the same name but different schema version', async () => {
      const config = { configName: 'avi', schemaId: 'https://mapcolonies.com/test/v1', config: {}, version: 1 };
      configRepository.getConfig = jest.fn().mockResolvedValue(undefined);
      configRepository.getAllConfigRefs = jest.fn().mockResolvedValue([]);

      configRepository.getConfigs = jest
        .fn()
        .mockResolvedValue({ totalCount: 1, configs: [{ version: 1, schemaId: 'https://mapcolonies.com/test/v2' }] });
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
        config: { avi: { $ref: { configName: 'refName', version: 'latest', schemaId: 'https://mapcolonies.com/test/v1' } } },
        version: 1,
      };
      const refs: ConfigRefResponse[] = [
        { configName: 'refName', version: 1, isLatest: true, config: { test: 'test' }, schemaId: 'https://mapcolonies.com/test/v1' },
      ];
      configRepository.getConfig = jest.fn().mockResolvedValue(undefined);
      configValidator.isValid = jest.fn().mockResolvedValue([true, null]);
      configRepository.getAllConfigRefs = jest.fn().mockResolvedValue(refs);
      configRepository.createConfig = jest.fn();
      // @ts-expect-error ts wants this to be a predicate
      configValidator.validateRef = jest.fn().mockReturnValue(true);
      configRepository.getConfigs = jest.fn().mockResolvedValue({ totalCount: 0, configs: [] });

      await configManager.createConfig({ ...config });

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(configRepository.createConfig).toHaveBeenCalledWith({
        ...config,
        createdBy: 'TBD',
        refs: [{ configName: 'refName', version: 'latest', schemaId: 'https://mapcolonies.com/test/v1' }],
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
      configRepository.getConfigs = jest.fn().mockResolvedValue({ totalCount: 0, configs: [] });

      await expect(configManager.createConfig(config)).rejects.toThrow(ConfigValidationError);
    });

    it('should throw ConfigSchemaMismatchError when the schema does not match the last entry', async () => {
      const config = { configName: 'avi', schemaId: 'https://mapcolonies.com/test/v1', config: {}, version: 1 };
      configRepository.getConfig = jest.fn().mockResolvedValue({ version: 1, schemaId: 'https://mapcolonies.com/test/v2' });

      await expect(configManager.createConfig(config)).rejects.toThrow(ConfigSchemaMismatchError);
    });

    it('should throw an error if config with the same name but different schema exists', async () => {
      const config = { configName: 'avi', schemaId: 'https://mapcolonies.com/xd/v1', config: {}, version: 1 };
      configRepository.getConfig = jest.fn().mockResolvedValue(undefined);
      configRepository.getConfigs = jest
        .fn()
        .mockResolvedValue({ totalCount: 1, configs: [{ version: 1, schemaId: 'https://mapcolonies.com/test/v2' }] });

      await expect(configManager.createConfig(config)).rejects.toThrow(
        'The schema of the config is not the same as the rest of the configs with the same name'
      );
    });
  });

  describe('insertDefaultConfigs', () => {
    const treeGeneratorSpy = jest.spyOn(utils, 'filesTreeGenerator');
    const readFileSyncSpy = jest.spyOn(fs, 'readFileSync');

    beforeEach(() => {
      jest.resetAllMocks();
      configManager.createConfig = jest.fn();
      configValidator.validateRef = jest.fn().mockReturnValue(true) as unknown as (ref: unknown) => ref is ConfigReference;
    });

    it('should insert the default configs', async () => {
      treeGeneratorSpy.mockImplementation(async function* () {
        await Promise.resolve();
        const dir = new Dirent();
        dir.name = 'avi.configs.json';
        dir.parentPath = '/path/to/configs';

        yield dir;
      });

      readFileSyncSpy.mockReturnValueOnce('[{"name": "avi", "value": {"avi":"avi"}}]');
      configRepository.getConfig = jest.fn().mockResolvedValue(undefined);

      await configManager.insertDefaultConfigs();

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(configManager.createConfig).toHaveBeenCalled();
    });

    it('should not insert the default configs if they already exist', async () => {
      treeGeneratorSpy.mockImplementation(async function* () {
        await Promise.resolve();
        const dir = new Dirent();
        dir.name = 'avi.configs.json';
        dir.parentPath = '/path/to/configs';

        yield dir;
      });

      readFileSyncSpy.mockReturnValueOnce('[{"name": "avi", "value": {"avi":"avi"}}]');
      configRepository.getConfig = jest.fn().mockResolvedValue({ configName: 'avi' });

      await configManager.insertDefaultConfigs();

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(configManager.createConfig).not.toHaveBeenCalled();
    });

    it('should insert referenced configs before the referencing ones', async () => {
      treeGeneratorSpy.mockImplementation(async function* () {
        await Promise.resolve();
        const dir = new Dirent();
        dir.name = 'avi.configs.json';
        dir.parentPath = '/path/to/configs';

        yield dir;
      });

      readFileSyncSpy.mockReturnValueOnce(
        '[{"name": "avi", "value": {"avi":"avi"}},{"name": "ref", "value": {"$ref":{"configName": "avi", "version": "latest"}}}]'
      );
      configRepository.getConfig = jest.fn().mockResolvedValue(undefined);
      await configManager.insertDefaultConfigs();

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(configManager.createConfig).toHaveBeenNthCalledWith(1, expect.objectContaining({ configName: 'avi' }));
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(configManager.createConfig).toHaveBeenNthCalledWith(2, expect.objectContaining({ configName: 'ref' }));
    });

    it('should throw an error if a referenced config does not exist', async () => {
      treeGeneratorSpy.mockImplementation(async function* () {
        await Promise.resolve();
        const dir = new Dirent();
        dir.name = 'avi.configs.json';
        dir.parentPath = '/path/to/configs';

        yield dir;
      });

      readFileSyncSpy.mockReturnValueOnce(
        '[{"name": "avi", "value": {"avi":"avi"}},{"name": "ref", "value": {"$ref":{"configName": "xd", "version": "latest"}}}]'
      );
      configRepository.getConfig = jest.fn().mockResolvedValue(undefined);
      await expect(configManager.insertDefaultConfigs()).rejects.toThrow('could not find config');
    });
  });

  describe('updateOldConfigs', () => {
    beforeEach(() => {
      configRepository.updateConfigToNewSchemaVersion = jest.fn();
    });

    it('should update old configs to new schema version', async () => {
      const oldConfigs = [
        {
          configName: 'config1',
          schemaId: 'https://mapcolonies.com/test/v1',
          version: 1,
          config: { test: 'value1' },
          createdAt: new Date(),
          createdBy: 'user1',
          isLatest: true,
          configSchemaVersion: 'v1',
        },
        {
          configName: 'config2',
          schemaId: 'https://mapcolonies.com/test/v1',
          version: 2,
          config: { test: 'value2' },
          createdAt: new Date(),
          createdBy: 'user2',
          isLatest: false,
          configSchemaVersion: 'v1',
        },
      ];

      // First call returns configs to update, second call returns empty (no more configs)
      configRepository.getConfigs = jest
        .fn()
        .mockResolvedValueOnce({ totalCount: 2, configs: oldConfigs })
        .mockResolvedValueOnce({ totalCount: 0, configs: [] });

      await configManager.updateOldConfigs();

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(configRepository.getConfigs).toHaveBeenCalledWith({ configSchemaVersion: 'v1' }, { offset: 0, limit: 1000 });
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(configRepository.updateConfigToNewSchemaVersion).toHaveBeenCalledWith({
        configName: 'config1',
        schemaId: 'https://mapcolonies.com/test/v1',
        version: 1,
        newSchemaVersion: 'v2',
        config: expect.any(Object) as Record<string, unknown>,
      });
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(configRepository.updateConfigToNewSchemaVersion).toHaveBeenCalledWith({
        configName: 'config2',
        schemaId: 'https://mapcolonies.com/test/v1',
        version: 2,
        newSchemaVersion: 'v2',
        config: expect.any(Object) as Record<string, unknown>,
      });
    });

    it('should handle case when no old configs exist', async () => {
      configRepository.getConfigs = jest.fn().mockResolvedValue({ totalCount: 0, configs: [] });

      await configManager.updateOldConfigs();

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(configRepository.getConfigs).toHaveBeenCalledWith({ configSchemaVersion: 'v1' }, { offset: 0, limit: 1000 });
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(configRepository.updateConfigToNewSchemaVersion).not.toHaveBeenCalled();
    });

    it('should process configs in batches', async () => {
      const batch1 = [
        {
          configName: 'config1',
          schemaId: 'https://mapcolonies.com/test/v1',
          version: 1,
          config: { test: 'value1' },
          createdAt: new Date(),
          createdBy: 'user1',
          isLatest: true,
          configSchemaVersion: 'v1',
        },
        {
          configName: 'config2',
          schemaId: 'https://mapcolonies.com/test/v1',
          version: 2,
          config: { test: 'value2' },
          createdAt: new Date(),
          createdBy: 'user2',
          isLatest: false,
          configSchemaVersion: 'v1',
        },
      ];
      const batch2 = [
        {
          configName: 'config3',
          schemaId: 'https://mapcolonies.com/test/v1',
          version: 1,
          config: { test: 'value3' },
          createdAt: new Date(),
          createdBy: 'user3',
          isLatest: true,
          configSchemaVersion: 'v1',
        },
      ];

      configRepository.getConfigs = jest
        .fn()
        .mockResolvedValueOnce({ totalCount: 2, configs: batch1 })
        .mockResolvedValueOnce({ totalCount: 1, configs: batch2 })
        .mockResolvedValueOnce({ totalCount: 0, configs: [] });

      await configManager.updateOldConfigs();

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(configRepository.getConfigs).toHaveBeenCalledTimes(3);
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(configRepository.updateConfigToNewSchemaVersion).toHaveBeenCalledTimes(3);
    });

    it('should continue processing if updateConfigToNewSchemaVersion fails', async () => {
      const oldConfigs = [
        {
          configName: 'config1',
          schemaId: 'https://mapcolonies.com/test/v1',
          version: 1,
          config: { test: 'value1' },
          createdAt: new Date(),
          createdBy: 'user1',
          isLatest: true,
          configSchemaVersion: 'v1',
        },
        {
          configName: 'config2',
          schemaId: 'https://mapcolonies.com/test/v1',
          version: 2,
          config: { test: 'value2' },
          createdAt: new Date(),
          createdBy: 'user2',
          isLatest: false,
          configSchemaVersion: 'v1',
        },
      ];

      configRepository.getConfigs = jest
        .fn()
        .mockResolvedValueOnce({ totalCount: 2, configs: oldConfigs })
        .mockResolvedValueOnce({ totalCount: 0, configs: [] });

      configRepository.updateConfigToNewSchemaVersion = jest
        .fn()
        .mockRejectedValueOnce(new Error('Database update failed'))
        .mockResolvedValueOnce(undefined);

      await configManager.updateOldConfigs();

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(configRepository.updateConfigToNewSchemaVersion).toHaveBeenCalledTimes(2);
    });

    it('should update configs with v1 format refs to v2 format', async () => {
      const oldConfigWithV1Refs = {
        configName: 'config1',
        schemaId: 'https://mapcolonies.com/test/v1',
        version: 1,
        config: {
          someValue: 'test',
          reference: {
            $ref: {
              configName: 'refConfig',
              version: 1,
            },
          },
        },
        createdAt: new Date(),
        createdBy: 'user1',
        isLatest: true,
        configSchemaVersion: 'v1',
      };

      // Mock the referenced config to return its schemaId
      const referencedConfig = {
        configName: 'refConfig',
        schemaId: 'https://mapcolonies.com/ref/v1',
        version: 1,
        config: {},
        createdAt: new Date(),
        createdBy: 'user1',
        isLatest: true,
        configSchemaVersion: 'v1',
      };

      configRepository.getConfigs = jest
        .fn()
        .mockResolvedValueOnce({ totalCount: 1, configs: [oldConfigWithV1Refs] })
        .mockResolvedValueOnce({ totalCount: 1, configs: [referencedConfig] })
        .mockResolvedValueOnce({ totalCount: 0, configs: [] });

      await configManager.updateOldConfigs();

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(configRepository.updateConfigToNewSchemaVersion).toHaveBeenCalledWith(
        expect.objectContaining({
          configName: 'config1',
          schemaId: 'https://mapcolonies.com/test/v1',
          version: 1,
          newSchemaVersion: 'v2',
          config: expect.objectContaining({
            someValue: 'test',
            reference: {
              $ref: {
                configName: 'refConfig',
                version: 1,
                schemaId: 'https://mapcolonies.com/ref/v1',
              },
            },
          }) as Record<string, unknown>,
        })
      );
    });
  });
});
