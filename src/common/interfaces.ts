import type { RequestHandler } from "express";
import type { paths } from "../schema";

type HasPathParams<T> = T extends { parameters: { path: NonNullable<any> } } ? T['parameters']['path'] : undefined;
type HasResponse<T> = T extends { responses: { ['200']: any } } ? T['responses']['200']['content']['application/json'] : undefined;
type HasRequestBody<T> = T extends { requestBody: any } ? T['requestBody']['content']['application/json'] : undefined;
type HasQueryParams<T> = T extends { parameters: { query?: NonNullable<any> } } ? T['parameters']['query'] : undefined;

export type TypedRequestHandler<Path extends keyof paths, Method extends keyof paths[Path]> = RequestHandler<
  HasPathParams<paths[Path][Method]>,
  HasResponse<paths[Path][Method]>,
  HasRequestBody<paths[Path][Method]>,
  HasQueryParams<paths[Path][Method]>
>;

export interface IConfig {
  get: <T>(setting: string) => T;
  has: (setting: string) => boolean;
}

export interface OpenApiConfig {
  filePath: string;
  basePath: string;
  jsonPath: string;
  uiPath: string;
}

