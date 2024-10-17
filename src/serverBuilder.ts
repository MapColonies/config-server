import express, { Router } from 'express';
import bodyParser from 'body-parser';
import compression from 'compression';
import { OpenapiViewerRouter, OpenapiRouterConfig } from '@map-colonies/openapi-express-viewer';
import { getErrorHandlerMiddleware } from '@map-colonies/error-express-handler';
import { middleware as OpenApiMiddleware } from 'express-openapi-validator';
import { inject, injectable } from 'tsyringe';
import { Logger } from '@map-colonies/js-logger';
import httpLogger from '@map-colonies/express-access-log-middleware';
import { getTraceContexHeaderMiddleware } from '@map-colonies/telemetry';
import { collectMetricsExpressMiddleware } from '@map-colonies/telemetry/prom-metrics';
import { SERVICES } from './common/constants';
import { IConfig } from './common/interfaces';
import { SCHEMA_ROUTER_SYMBOL } from './schemas/routes/schemaRouter';
import { CAPABILITIES_ROUTER_SYMBOL } from './capabilities/routes/capabilitiesRouter';
import { CONFIG_ROUTER_SYMBOL } from './configs/routes/configRouter';

@injectable()
export class ServerBuilder {
  private readonly serverInstance: express.Application;
  private readonly openapiFilePath: string;
  private readonly apiPrefix: string;

  public constructor(
    @inject(SERVICES.CONFIG) private readonly config: IConfig,
    @inject(SERVICES.LOGGER) private readonly logger: Logger,
    @inject(SCHEMA_ROUTER_SYMBOL) private readonly schemaRouter: Router,
    @inject(CAPABILITIES_ROUTER_SYMBOL) private readonly capabilitiesRouter: Router,
    @inject(CONFIG_ROUTER_SYMBOL) private readonly configRouter: Router
  ) {
    this.serverInstance = express();
    this.openapiFilePath = this.config.get<string>('openapiConfig.filePath');
    this.apiPrefix = this.config.get<string>('server.apiPrefix');
  }

  public build(): express.Application {
    this.registerPreRoutesMiddleware();
    this.buildRoutes();
    this.registerPostRoutesMiddleware();

    return this.serverInstance;
  }

  private buildDocsRoutes(): void {
    const openapiRouter = new OpenapiViewerRouter({
      ...this.config.get<OpenapiRouterConfig>('openapiConfig'),
      filePathOrSpec: this.openapiFilePath,
    });
    openapiRouter.setup();
    this.serverInstance.use(this.apiPrefix, openapiRouter.getRouter());
  }

  private buildRoutes(): void {
    const router = Router();
    router.use('/schema', this.schemaRouter);
    router.use('/capabilities', this.capabilitiesRouter);
    router.use('/config', this.configRouter);
    this.serverInstance.use(this.config.get('server.apiPrefix'), router);

    this.buildDocsRoutes();
  }

  private registerPreRoutesMiddleware(): void {
    this.serverInstance.use(new RegExp(`(/metrics)|${this.apiPrefix}.*`),collectMetricsExpressMiddleware({}));
    this.serverInstance.use(httpLogger({ logger: this.logger, ignorePaths: ['/metrics'] }));

    if (this.config.get<boolean>('server.response.compression.enabled')) {
      this.serverInstance.use(compression(this.config.get<compression.CompressionFilter>('server.response.compression.options')));
    }

    this.serverInstance.use(bodyParser.json(this.config.get<bodyParser.Options>('server.request.payload')));
    this.serverInstance.use(getTraceContexHeaderMiddleware());

    const ignorePathRegex = new RegExp(`^${this.config.get<string>('openapiConfig.basePath')}/.*`, 'i');
    this.serverInstance.use(
      this.config.get<string>('server.apiPrefix'),
      OpenApiMiddleware({ apiSpec: this.openapiFilePath, validateRequests: true, ignorePaths: ignorePathRegex })
    );
  }

  private registerPostRoutesMiddleware(): void {
    const isStaticEnabled = this.config.get<boolean>('server.staticAssets.enabled');

    if (isStaticEnabled) {
      const staticPath = this.config.get<string>('server.staticAssets.folder');
      // we use the static middleware twice. the second one is to catch subpath requests and serve the index.html
      // api is not affected by this middleware as the OpenApiMiddleware is registered before and sets 404 for all api misses
      this.serverInstance.use(express.static(staticPath));
      this.serverInstance.use('*', express.static(staticPath));
    }

    this.serverInstance.use(getErrorHandlerMiddleware());
  }
}
