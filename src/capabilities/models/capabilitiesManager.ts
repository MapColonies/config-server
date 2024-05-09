import { Logger } from '@map-colonies/js-logger';
import { inject, injectable } from 'tsyringe';
import { readPackageJsonSync } from '@map-colonies/read-pkg';
import { SERVICES } from '../../common/constants';
import { paths } from '../../openapiTypes';

const schemasPackagePath = require.resolve('@map-colonies/schemas').substring(0, require.resolve('@map-colonies/schemas').indexOf('build'));
const schemasPackageVersion = readPackageJsonSync(schemasPackagePath + 'package.json').version as string;
const serverVersion = readPackageJsonSync('package.json').version as string;

@injectable()
export class CapabilitiesManager {
  public constructor(@inject(SERVICES.LOGGER) private readonly logger: Logger) {}

  public getCapabilities(): paths['/capabilities']['get']['responses']['200']['content']['application/json'] {
    return {
      serverVersion,
      schemasPackageVersion,
      pubSubEnabled: false,
    };
  }
}
