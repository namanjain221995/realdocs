/**
 * Pure helpers that turn the JSON Schema inside the service API's OpenAPI
 * document (draft 2020-12, no `$ref`, produced by zod's `toJSONSchema`) into
 * flat table rows. Nothing here touches React or the network.
 */

export interface JsonSchema {
  type?: string | string[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: unknown[];
  const?: unknown;
  default?: unknown;
  format?: string;
  description?: string;
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
  allOf?: JsonSchema[];
  additionalProperties?: boolean | JsonSchema;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  pattern?: string;
}

export interface SchemaRow {
  /** Dotted path, `[]` for array items: `participants[].role`. Unique within one schema. */
  path: string;
  /** The last segment: the property name, or `[]` / `value` for anonymous parts. */
  name: string;
  /** Nesting level, 0 for top-level properties. */
  depth: number;
  /** `string`, `integer`, `array of string`, `string | null`, `one of: object | string` … */
  type: string;
  required: boolean;
  nullable: boolean;
  description: string;
  /** Short facts after the description: `format: date-time`, `values: a, b`, `default: true`, `max length 120`. */
  details: string[];
}

const MAX_DEPTH = 8;

function isObject(value: unknown): value is JsonSchema {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNullSchema(schema: JsonSchema): boolean {
  return schema.type === 'null';
}

/** `anyOf: [X, {type:'null'}]` is how zod writes a nullable X. */
function splitNullable(schema: JsonSchema): { schema: JsonSchema; nullable: boolean } {
  const variants = schema.anyOf ?? schema.oneOf;
  if (!variants) {
    if (Array.isArray(schema.type) && schema.type.includes('null')) {
      const rest = schema.type.filter((entry) => entry !== 'null');
      return {
        schema: { ...schema, type: rest.length === 1 ? rest[0] : rest },
        nullable: true,
      };
    }
    return { schema, nullable: false };
  }
  const nonNull = variants.filter((variant) => isObject(variant) && !isNullSchema(variant));
  if (nonNull.length === variants.length) return { schema, nullable: false };
  if (nonNull.length === 1) {
    const only = nonNull[0] as JsonSchema;
    // Keep the outer description and default (zod puts them beside the anyOf).
    const { anyOf: _a, oneOf: _o, ...outer } = schema;
    return {
      schema: { ...outer, ...only, description: outer.description ?? only.description },
      nullable: true,
    };
  }
  const { anyOf: _a, oneOf: _o, ...outer } = schema;
  const key = schema.anyOf ? 'anyOf' : 'oneOf';
  return { schema: { ...outer, [key]: nonNull }, nullable: true };
}

/** A one-line type name for a schema (no expansion of nested properties). */
export function typeLabel(input: JsonSchema | undefined): string {
  if (!isObject(input)) return 'any';
  const { schema, nullable } = splitNullable(input);
  const base = baseLabel(schema);
  return nullable ? `${base} | null` : base;
}

function baseLabel(schema: JsonSchema): string {
  if (schema.const !== undefined) return JSON.stringify(schema.const);
  const variants = schema.anyOf ?? schema.oneOf;
  if (variants) return `one of: ${variants.map((variant) => typeLabel(variant)).join(' | ')}`;
  if (schema.allOf) return schema.allOf.map((part) => typeLabel(part)).join(' & ');
  if (Array.isArray(schema.type)) return schema.type.join(' | ');
  if (schema.type === 'array') return `array of ${typeLabel(schema.items)}`;
  if (schema.type === 'object') {
    if (isObject(schema.additionalProperties) && !schema.properties) {
      return `map of string to ${typeLabel(schema.additionalProperties)}`;
    }
    return 'object';
  }
  if (schema.type) return schema.type;
  if (schema.enum) return 'enum';
  if (schema.properties) return 'object';
  return 'any';
}

/** Constraints and extras worth showing next to the description. */
export function schemaDetails(schema: JsonSchema | undefined): string[] {
  if (!isObject(schema)) return [];
  const { schema: s } = splitNullable(schema);
  const out: string[] = [];
  if (s.format) out.push(`format: ${s.format}`);
  if (s.enum) out.push(`values: ${s.enum.map((value) => String(value)).join(', ')}`);
  if (s.default !== undefined) out.push(`default: ${JSON.stringify(s.default)}`);
  if (s.minimum !== undefined) out.push(`min ${s.minimum}`);
  if (s.maximum !== undefined) out.push(`max ${s.maximum}`);
  if (s.minLength !== undefined) out.push(`min length ${s.minLength}`);
  if (s.maxLength !== undefined) out.push(`max length ${s.maxLength}`);
  if (s.minItems !== undefined) out.push(`min items ${s.minItems}`);
  if (s.maxItems !== undefined) out.push(`max items ${s.maxItems}`);
  if (s.pattern) out.push(`pattern: ${s.pattern}`);
  return out;
}

/** Child schemas that get rows of their own below a property: object members and array-item members. */
function childrenOf(schema: JsonSchema): { prefix: string; schema: JsonSchema } | null {
  if (schema.properties) return { prefix: '', schema };
  if (schema.type === 'array' && isObject(schema.items)) {
    const item = splitNullable(schema.items).schema;
    if (item.properties) return { prefix: '[]', schema: item };
  }
  if (isObject(schema.additionalProperties)) {
    const value = splitNullable(schema.additionalProperties).schema;
    if (value.properties) return { prefix: '{key}', schema: value };
  }
  return null;
}

function pushRows(
  schema: JsonSchema,
  parentPath: string,
  depth: number,
  rows: SchemaRow[],
  seen: number,
): void {
  const required = new Set(schema.required ?? []);
  for (const [name, property] of Object.entries(schema.properties ?? {})) {
    const { schema: inner, nullable } = splitNullable(isObject(property) ? property : {});
    const path = parentPath ? `${parentPath}.${name}` : name;
    rows.push({
      path,
      name,
      depth,
      type: nullable ? `${baseLabel(inner)} | null` : baseLabel(inner),
      required: required.has(name),
      nullable,
      description: inner.description ?? '',
      details: schemaDetails(inner),
    });
    const children = seen < MAX_DEPTH ? childrenOf(inner) : null;
    if (children) {
      pushRows(children.schema, `${path}${children.prefix}`, depth + 1, rows, seen + 1);
    }
  }
}

/**
 * Flattens a schema into rows, parents before children. An object schema
 * yields one row per property (recursing into nested objects, arrays of
 * objects and maps of objects); any other schema yields a single row named
 * `value`. `anyOf`/`oneOf` are listed in the type, not expanded.
 */
export function schemaRows(input: JsonSchema | undefined): SchemaRow[] {
  if (!isObject(input)) return [];
  const { schema, nullable } = splitNullable(input);
  const rows: SchemaRow[] = [];
  if (schema.properties) {
    pushRows(schema, '', 0, rows, 0);
    return rows;
  }
  const children = childrenOf(schema);
  rows.push({
    path: 'value',
    name: 'value',
    depth: 0,
    type: nullable ? `${baseLabel(schema)} | null` : baseLabel(schema),
    required: true,
    nullable,
    description: schema.description ?? '',
    details: schemaDetails(schema),
  });
  if (children)
    pushRows(children.schema, children.prefix === '[]' ? 'value[]' : 'value', 1, rows, 1);
  return rows;
}
