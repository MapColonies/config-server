export interface SchemaIndexEntry {
  id: string;
  name: string;
  path: string;
  version: string;
  description?: string;
  category: string;
  title?: string;
}

export interface Dependencies {
  internal: string[];
  external: string[];
}

export interface EnvVar {
  envVariable: string; // Matches frontend interface
  configPath: string; // Matches frontend interface
  format?: string;
  type?: string;
  required?: boolean;
  description?: string;
  default?: unknown;
  refLink?: string;
}

export interface FullSchemaMetadata {
  id: string;
  name: string;
  path: string;
  version: string;
  category: string;
  description?: string;
  title?: string;
  rawContent: Record<string, unknown>;
  dereferencedContent: Record<string, unknown>;
  typeContent: string | null;
  dependencies: Dependencies;
  envVars: EnvVar[];
}
