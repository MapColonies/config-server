import 'jest-openapi';
import { describe, beforeEach, it, expect } from 'vitest';
import { CapabilitiesManager } from '@src/capabilities/models/capabilitiesManager';

describe('CapabilitiesManager', () => {
  let capabilitiesManager: CapabilitiesManager;

  beforeEach(() => {
    capabilitiesManager = new CapabilitiesManager();
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
