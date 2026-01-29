# Backend Implementation Plan: Schema UI Integration

## Overview

Add two new endpoints to provide comprehensive schema metadata for the enhanced schema viewer UI. This document outlines the backend changes needed to support the full schema UI integration. Make sure to not invent the wheel, and reuse existing logic where possible.

## Design Decision: Client-Side Search

**Decision**: The backend returns only schema metadata arrays. Frontend builds its own FlexSearch index client-side.

**Rationale**:

- With ~500 schemas at ~200 bytes each = ~100KB of data
- FlexSearch can build client-side index in 10-30ms
- Simpler architecture, less backend complexity
- No need to serialize/deserialize FlexSearch index
- Frontend has full control over search ranking and fields

## New API Endpoints

### 1. GET /schema/index

**Purpose**: Provide a lightweight, searchable index of all available schemas for frontend to build search index.

**Response Schema**:

```typescript
{
  schemas: Array<{
    id: string; // e.g., "https://mapcolonies.com/common/db/full/v1"
    name: string; // e.g., "commonDbFull"
    path: string; // e.g., "common/db/full/v1"
    version: string; // e.g., "v1"
    description?: string; // From schema description field
    category: string; // e.g., "common", "infra", "vector"
    title?: string; // From schema title field
  }>;
}
```

**Implementation Steps**:

1. **Load all schemas from package**:

   ```typescript
   // Assuming schemas are available via imported package
   import * as schemas from '@map-colonies/schemas';

   // Or if schemas are in local directory structure:
   const schemasDir = path.join(__dirname, '../schemas');
   ```

2. **Build schema index**:

   ```typescript
   interface SchemaIndexEntry {
     id: string;
     name: string;
     path: string;
     version: string;
     description?: string;
     category: string;
     title?: string;
   }

   function buildSchemaIndex(): SchemaIndexEntry[] {
     const schemas: SchemaIndexEntry[] = [];

     // Iterate through all schema files
     // Extract: $id, title, description from each schema
     // Parse category from path (e.g., "common/db/full/v1" -> "common")
     // Parse name and version from path

     return schemas;
   }
   ```

3. **Cache the result**:

   - Generate index once at startup or on-demand
   - Cache in memory (schemas rarely change)
   - Optionally: regenerate on schema package version change

4. **HTTP Response Headers**:
   ```typescript
   response.setHeader('Cache-Control', 'public, max-age=3600'); // 1 hour
   ```

**OpenAPI Spec Addition**:

```yaml
/schema/index:
  get:
    operationId: getSchemasIndex
    summary: Get searchable index of all schemas
    description: Returns metadata for all schemas. Frontend can build client-side search index from this data.
    responses:
      '200':
        description: OK
        content:
          application/json:
            schema:
              type: object
              required:
                - schemas
              properties:
                schemas:
                  type: array
                  items:
                    type: object
                    required:
                      - id
                      - name
                      - path
                      - version
                      - category
                    properties:
                      id:
                        type: string
                        format: uri
                      name:
                        type: string
                      path:
                        type: string
                      version:
                        type: string
                      description:
                        type: string
                      category:
                        type: string
                      title:
                        type: string
      '500':
        $ref: '#/components/responses/500InternalServerError'
```

---

### 2. GET /schema/full

**Purpose**: Return comprehensive schema metadata including TypeScript types, dependencies, and environment variables.

**Query Parameters**:

- `id` (required): Schema ID (e.g., `https://mapcolonies.com/common/db/full/v1`)

**Response Schema**:

```typescript
{
  id: string;
  name: string;
  path: string;
  version: string;
  category: string;
  description?: string;
  title?: string;
  rawContent: object;              // Raw JSON Schema
  dereferencedContent: object;     // All $refs resolved
  typeContent: string;             // TypeScript definitions
  dependencies: {
    internal: string[];            // #/definitions/xyz references
    external: string[];            // https://... references
  };
  envVars: Array<{
    envVariable: string;           // Environment variable name (matches frontend)
    configPath: string;            // Property path e.g., "db.host" (matches frontend)
    format?: string;               // From x-env-format or format field
    type?: string;                 // e.g., "string", "integer"
    required?: boolean;            // Is field required
    description?: string;          // Schema description
    default?: any;                 // Default value
    refLink?: string;              // External schema ref if from $ref
  }>;
}
```

**Implementation Steps**:

1. **Load and parse schema**:

   ```typescript
   function getSchemaById(schemaId: string): object | null {
     // Load schema from package or filesystem
     // Return parsed JSON schema
   }
   ```

2. **Extract TypeScript types**:

   ```typescript
   function getTypeScriptForSchema(schemaId: string): string | null {
     // Access generated .d.ts files from schemas package
     // Extract the relevant type definition
     // Example: Look for export matching schema name

     // Path mapping:
     // "https://mapcolonies.com/common/db/full/v1"
     // -> Look in schemas package types for commonDbFullV1

     return typeScriptContent;
   }
   ```

3. **Extract dependencies**:

   ```typescript
   interface Dependencies {
     internal: string[];
     external: string[];
   }

   function extractDependencies(schema: any): Dependencies {
     const internal = new Set<string>();
     const external = new Set<string>();

     function traverse(obj: any) {
       if (!obj || typeof obj !== 'object') return;

       if (obj.$ref && typeof obj.$ref === 'string') {
         if (obj.$ref.startsWith('#/')) {
           internal.add(obj.$ref);
         } else if (obj.$ref.startsWith('https://')) {
           external.add(obj.$ref);
         }
       }

       // Recursively traverse all properties
       for (const key in obj) {
         if (Array.isArray(obj[key])) {
           obj[key].forEach(traverse);
         } else if (typeof obj[key] === 'object') {
           traverse(obj[key]);
         }
       }
     }

     traverse(schema);

     return {
       internal: Array.from(internal),
       external: Array.from(external),
     };
   }
   ```

4. **Extract environment variables**:

   ```typescript
   interface EnvVar {
     envVariable: string; // Matches frontend interface
     configPath: string; // Matches frontend interface
     format?: string;
     type?: string;
     required?: boolean;
     description?: string;
     default?: any;
     refLink?: string;
   }

   function extractEnvVars(
     schema: any,
     pathPrefix: string = '',
     requiredFields: Set<string> = new Set(),
     visitedRefs: Set<string> = new Set()
   ): EnvVar[] {
     const envVars: EnvVar[] = [];

     if (!schema || typeof schema !== 'object') return envVars;

     // Handle $ref - resolve and recurse
     if (schema.$ref && typeof schema.$ref === 'string') {
       if (visitedRefs.has(schema.$ref)) return envVars;
       visitedRefs.add(schema.$ref);

       const resolvedSchema = resolveRef(schema.$ref, schema);
       if (resolvedSchema) {
         const refVars = extractEnvVars(resolvedSchema, pathPrefix, requiredFields, visitedRefs);

         // Tag with refLink if external
         if (schema.$ref.startsWith('https://')) {
           refVars.forEach((v) => (v.refLink = schema.$ref));
         }

         envVars.push(...refVars);
       }
     }

     // Check current level for x-env-value
     if (schema['x-env-value']) {
       const propertyName = pathPrefix.split('.').pop() || pathPrefix;
       envVars.push({
         envVariable: schema['x-env-value'], // Use frontend property name
         configPath: pathPrefix, // Use frontend property name
         format: schema['x-env-format'] || schema.format,
         type: schema.type || 'any',
         required: requiredFields.has(propertyName),
         description: schema.description,
         default: schema.default,
       });
     }

     // Handle allOf, oneOf, anyOf
     ['allOf', 'oneOf', 'anyOf'].forEach((key) => {
       if (Array.isArray(schema[key])) {
         schema[key].forEach((subSchema: any) => {
           envVars.push(...extractEnvVars(subSchema, pathPrefix, requiredFields, visitedRefs));
         });
       }
     });

     // Recursively process properties
     if (schema.properties) {
       const required = new Set(schema.required || []);

       Object.entries(schema.properties).forEach(([propName, propSchema]) => {
         const newPath = pathPrefix ? `${pathPrefix}.${propName}` : propName;
         envVars.push(...extractEnvVars(propSchema, newPath, required, visitedRefs));
       });
     }

     // Process definitions
     if (schema.definitions) {
       Object.entries(schema.definitions).forEach(([defName, defSchema]) => {
         envVars.push(...extractEnvVars(defSchema, pathPrefix, requiredFields, visitedRefs));
       });
     }

     return envVars;
   }

   function resolveRef(ref: string, rootSchema: any): any {
     if (ref.startsWith('#/')) {
       // Internal reference
       const path = ref.substring(2).split('/');
       let result = rootSchema;
       for (const segment of path) {
         result = result?.[segment];
       }
       return result;
     } else if (ref.startsWith('https://')) {
       // External reference - load that schema
       return getSchemaById(ref);
     }
     return null;
   }
   ```

5. **Assemble response**:

   ```typescript
   async function getFullSchemaMetadata(schemaId: string) {
     const rawContent = getSchemaById(schemaId);
     if (!rawContent) {
       throw new NotFoundError(`Schema not found: ${schemaId}`);
     }

     // Reuse existing dereferencing logic from GET /schema
     const dereferencedContent = await dereferenceSchema(rawContent);

     const typeContent = getTypeScriptForSchema(schemaId);
     const dependencies = extractDependencies(rawContent);
     const envVars = extractEnvVars(rawContent);

     // Parse metadata from schemaId
     const path = schemaId.replace('https://mapcolonies.com/', '');
     const parts = path.split('/');
     const category = parts[0];
     const version = parts[parts.length - 1];

     return {
       id: schemaId,
       name: rawContent.title || extractNameFromId(schemaId),
       path,
       version,
       category,
       description: rawContent.description,
       title: rawContent.title,
       rawContent,
       dereferencedContent,
       typeContent,
       dependencies,
       envVars,
     };
   }
   ```

6. **Cache strategy**:

   ```typescript
   // Cache full schema metadata (expensive to compute)
   const schemaCache = new Map<string, any>();

   function getCachedFullSchema(schemaId: string) {
     if (!schemaCache.has(schemaId)) {
       schemaCache.set(schemaId, getFullSchemaMetadata(schemaId));
     }
     return schemaCache.get(schemaId);
   }
   ```

**OpenAPI Spec Addition**:

```yaml
/schema/full:
  get:
    operationId: getFullSchema
    summary: Get comprehensive schema metadata
    parameters:
      - name: id
        in: query
        description: The id of the requested schema
        required: true
        schema:
          $ref: '#/components/schemas/schemaId'
    responses:
      '200':
        description: OK
        content:
          application/json:
            schema:
              type: object
              required:
                - id
                - name
                - path
                - version
                - category
                - rawContent
                - dereferencedContent
                - dependencies
                - envVars
              properties:
                id:
                  type: string
                  format: uri
                name:
                  type: string
                path:
                  type: string
                version:
                  type: string
                category:
                  type: string
                description:
                  type: string
                title:
                  type: string
                rawContent:
                  type: object
                  description: Raw JSON Schema
                dereferencedContent:
                  type: object
                  description: Schema with all $refs resolved
                typeContent:
                  type: string
                  nullable: true
                  description: TypeScript type definitions
                dependencies:
                  type: object
                  required:
                    - internal
                    - external
                  properties:
                    internal:
                      type: array
                      items:
                        type: string
                      description: Internal references (#/definitions/...)
                    external:
                      type: array
                      items:
                        type: string
                      description: External schema references (https://...)
                envVars:
                  type: array
                  items:
                    type: object
                    required:
                      - envVariable
                      - configPath
                    properties:
                      envVariable:
                        type: string
                        description: Environment variable name
                      configPath:
                        type: string
                        description: JSON path to the property (e.g., "db.host")
                      format:
                        type: string
                        description: Format hint (from x-env-format or format field)
                      type:
                        type: string
                        description: JSON schema type (e.g., "string", "integer")
                      required:
                        type: boolean
                        description: Whether this field is required
                      description:
                        type: string
                        description: Schema description
                      default:
                        description: Default value (any type)
                      refLink:
                        type: string
                        format: uri
                        description: External schema reference if this env var comes from a $ref
      '400':
        $ref: '#/components/responses/400BadRequest'
      '404':
        $ref: '#/components/responses/404NotFound'
      '500':
        $ref: '#/components/responses/500InternalServerError'
```

---

## Dependencies

**Note**: FlexSearch is NOT required on the backend. Frontend will use FlexSearch client-side to build search index from the schemas array.

If frontend needs FlexSearch:

```bash
npm install flexsearch
```

---

## Testing Checklist

### GET /schema/index

- [x] Returns all schemas from package
- [x] Categories are correctly extracted
- [x] Proper cache headers set
- [x] Schemas array has all required metadata fields

### GET /schema/full

- [x] Returns 404 for non-existent schema
- [x] Raw content matches source schema file
- [x] Dereferenced content has no $refs
- [x] TypeScript types are correctly extracted
- [x] Internal dependencies (#/definitions) correctly found
- [x] External dependencies (https://) correctly found
- [x] Environment variables extracted at all levels
- [x] Environment variables from $refs tagged with refLink
- [x] Circular $refs don't cause infinite loops
- [x] Required fields correctly identified

---

## Performance Considerations

1. **Schema Index**: Build once at startup, cache in memory
2. **Full Schema Metadata**: Cache per schema ID (schemas are immutable)
3. **TypeScript Extraction**: Cache results (expensive file I/O)
4. **Dereferencing**: Reuse existing logic, ensure proper caching

---

## Migration Notes

- These endpoints supplement the existing `GET /schema` endpoint
- No breaking changes to existing endpoints
- Frontend can gradually migrate to use new endpoints
- Old schema route can coexist with new enhanced route

---

## Code Reuse: Environment Variables Extraction

**Important**: The env var extraction logic should be **shared between**:

- **Schema page** (showing all possible env vars in a schema)
- **Config page** (already has `EnvironmentOverridesTable` component)

### Current State

The config page at `src/routes/config/$name/$version.tsx` already has:

- "Env Overrides" tab showing environment variables
- `EnvironmentOverridesTable` component with extraction logic
- Fetches dereferenced schema to extract env vars

### Unified Approach

The backend `GET /schema/full` endpoint should return env vars in a format compatible with the **enhanced** `EnvironmentOverridesTable` component:

```typescript
// Enhanced interface in EnvironmentOverridesTable.tsx
interface EnvironmentOverride {
  envVariable: string; // Same as backend's envName
  configPath: string; // Same as backend's propertyPath
  format?: string; // From x-env-format
  // Optional extended fields for schema page
  type?: string;
  required?: boolean;
  description?: string;
  default?: unknown;
  refLink?: string;
}
```

**Backend should return** (mapped to match interface):

```typescript
{
  envVars: Array<{
    envVariable: string; // NOT envName
    configPath: string; // NOT propertyPath
    format?: string; // From x-env-format
    type?: string;
    required?: boolean;
    description?: string;
    default?: any;
    refLink?: string;
  }>;
}
```

### Usage

**On Config Page** (existing - no changes needed):

- Fetches dereferenced schema via `GET /schema?shouldDereference=true`
- Extracts env vars client-side via `extractEnvironmentOverrides()` function
- Shows in `EnvironmentOverridesTable` component
- `<EnvironmentOverridesTable schema={schema} />`

**On Schema Page** (new):

- Fetches `GET /schema/full?id={schemaId}`
- Uses pre-extracted `envVars` from backend (already in correct format)
- Shows in **same** `EnvironmentOverridesTable` component with extended columns
- `<EnvironmentOverridesTable envVars={data.envVars} showExtendedColumns />`

### Why Enhance Instead of Duplicate?

**Same Data**: Both pages show env vars from the **same dereferenced schema**

**Single Component**: One component with conditional rendering

- Config page: 3 columns (Env Variable, Config Path, Format)
- Schema page: 7 columns (adds Type, Required, Default, Description)

**Benefits**:

- No code duplication
- Easier maintenance
- No breaking changes to config page
- Backend provides richer data that frontend can choose to display

---

## Open Questions / Implementation Details

1. **TypeScript File Location**: Confirm exact path/structure of generated `.d.ts` files in schemas package
2. **Schema Package Access**: Confirm how backend accesses schemas (npm package, local files, etc.)
3. **Version Management**: How to handle schema package updates? Restart required or hot-reload?
4. **Error Handling**: Define behavior for schemas with invalid $refs or malformed x-env-value
5. **x-env-format**: Ensure backend extraction includes `x-env-format` field (used by config page)
