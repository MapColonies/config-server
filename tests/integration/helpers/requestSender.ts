import { readFileSync } from 'node:fs';
import supertest from 'supertest';
import { OpenAPIV3 } from 'openapi-types';
import OASNormalize from 'oas-normalize';
import { paths, operations } from '../../../src/openapiTypes';

/* eslint-disable @typescript-eslint/no-explicit-any */
// type HasPathParams<T> = T extends { parameters: { path: NonNullable<any> } } ? T['parameters']['path'] : undefined;
// type HasRequestBody<T> = T extends { requestBody: any } ? T['requestBody']['content']['application/json'] : undefined;
// type HasQueryParams<T> = T extends { parameters: { query?: NonNullable<any> } } ? T['parameters']['query'] : undefined;

type HasResponse<T> = T extends { responses: { ['200']: any } } ? T['responses']['200']['content']['application/json'] : undefined;
type PathParamsObj<T> = T extends { parameters: { path: NonNullable<any> } } ? { pathParams: T['parameters']['path'] } : { pathParams?: undefined };
type QueryParamsObj<T> = T extends { parameters: { query?: NonNullable<any> } }
  ? { queryParams: T['parameters']['query'] }
  : { queryParams?: Record<string, string> };
type RequestBodyObj<T> = T extends { requestBody: { content: any } }
  ? { requestBody: T['requestBody']['content']['application/json'] }
  : { requestBody?: any };

type PathRequestOptions<Path extends keyof paths, Method extends keyof paths[Path]> = { path: Path; method: Method } & PathParamsObj<
  paths[Path][Method]
> &
  QueryParamsObj<paths[Path][Method]> &
  RequestBodyObj<paths[Path][Method]>;

type PathRequestReturn<Path extends keyof paths, Method extends keyof paths[Path]> = Promise<
  {
    body: HasResponse<paths[Path][Method]>;
  } & Omit<Awaited<supertest.Test>, 'body'>
>;

// eslint-disable-next-line @typescript-eslint/promise-function-async
function sendRequest<Path extends keyof paths, Method extends keyof paths[Path]>(
  app: Express.Application,
  options: PathRequestOptions<Path, Method>
): PathRequestReturn<Path, Method> {
  const method = options.method as 'get' | 'post' | 'put' | 'delete' | 'patch';

  let actualPath = options.path as string;

  if (options.pathParams !== undefined) {
    actualPath = Object.entries(options.pathParams).reduce((acc, [key, value]) => acc.replace(`{${key}}`, value as string), actualPath);
  }

  if (actualPath.includes('{') || actualPath.includes('}')) {
    throw new Error('Path params are not provided');
  }

  let request = supertest.agent(app)[method](actualPath);

  if (options.queryParams !== undefined) {
    request = request.query(options.queryParams);
  }

  if (options.requestBody !== undefined) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    request = request.send(options.requestBody);
  }

  return request.set('Content-Type', 'application/json');
}

type OperationsNames = keyof operations;

type OperationRequestOptions<OperationKey extends keyof operations> = PathParamsObj<operations[OperationKey]> &
  QueryParamsObj<operations[OperationKey]> &
  RequestBodyObj<operations[OperationKey]>;

type OperationRequestReturn<Operation extends OperationsNames> = Promise<
  {
    body: HasResponse<operations[Operation]>;
  } & Omit<Awaited<supertest.Test>, 'body'>
> &
  supertest.Test;

type RequestSenderObj = {
  sendRequest: <Path extends keyof paths, Method extends keyof paths[Path]>(
    options: PathRequestOptions<Path, Method>
  ) => PathRequestReturn<Path, Method>;
} & {
  [operation in OperationsNames]: (options: OperationRequestOptions<operation>) => OperationRequestReturn<operation>;
};

const methods = ['get', 'post', 'put', 'delete', 'patch'] as const;

function getOperationPathAndMethod(openapi: Awaited<ReturnType<OASNormalize['deref']>>): Record<OperationsNames, { path: string; method: string }> {
  const result = {} as Record<OperationsNames, { path: string; method: string }>;

  if (openapi.paths === undefined) {
    throw new Error('No paths found in the OpenAPI file');
  }

  for (const [path, pathValue] of Object.entries(openapi.paths)) {
    if (pathValue === undefined) {
      continue;
    }

    const pathObject = pathValue as OpenAPIV3.PathItemObject;

    for (const method of methods) {
      if (pathObject[method] !== undefined) {
        const operationId = pathObject[method]?.operationId;

        if (operationId === undefined) {
          throw new Error(`OperationId is not defined for ${method} method on ${path}`);
        }

        // @ts-ignore
        result[operationId] = {
          path,
          method,
        };
      }
    }
  }

  return result as Record<OperationsNames, { path: string; method: string }>;
}

// eslint-disable-next-line @typescript-eslint/naming-convention
export async function RequestSender(openapiFilePath: string, app: Express.Application): Promise<RequestSenderObj> {
  const fileContent = readFileSync(openapiFilePath, 'utf-8');
  const normalized = new OASNormalize(fileContent);
  const derefed = await normalized.deref();
  const operationPathAndMethod = getOperationPathAndMethod(derefed);
  
  // const openapi = await parse(fileContent);
  // @ts-ignore
  const returnObj: RequestSenderObj = {
    // eslint-disable-next-line @typescript-eslint/promise-function-async
    sendRequest: (options) => sendRequest(app, options),
  }

  for (const [operation, { path, method }] of Object.entries(operationPathAndMethod)) {
    // @ts-ignore
    returnObj[operation] = async (options) => sendRequest(app, { path, method, ...options});
  }

  return returnObj;
}

// const requestSender = await RequestSender();

// const a = requestSender.getConfigs({
//   queryParams: {

//   }
// });
