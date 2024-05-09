import 'jest-openapi';
import jsLogger from '@map-colonies/js-logger';
import { CapabilitiesManager } from '../../../../src/capabilities/models/capabilitiesManager';

describe('CapabilitiesManager', () => {
  let capabilitiesManager: CapabilitiesManager;

  beforeEach(() => {
    capabilitiesManager = new CapabilitiesManager(jsLogger({ enabled: false }));
  });

  describe('#getCapabilities', () => {
    it('should return the schema tree', () => {
      // Act
      const capabilities = capabilitiesManager.getCapabilities();

      // Assert
      expect(capabilities).toSatisfySchemaInApiSpec('capabilities');
    });
  });
});
