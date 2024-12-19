import { injectable } from 'tsyringe';
import { readPackageJsonSync } from '@map-colonies/read-pkg';
import { paths } from '@openapi';
import { schemasPackageVersion } from '@common/constants';
import { withSpan } from '@common/tracing';

const serverVersion = readPackageJsonSync('package.json').version as string;

@injectable()
export class CapabilitiesManager {
  @withSpan()
  public getCapabilities(): paths['/capabilities']['get']['responses']['200']['content']['application/json'] {
    return {
      serverVersion,
      schemasPackageVersion,
      pubSubEnabled: false,
    };
  }
}
