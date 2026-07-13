// src/lib/ai/tools/validate.ts
//
// M8 — JSON-Schema-lite validator. The AI proposes a tool call with
// argument JSON; before ANY execution touches storage or an HTTP call,
// we validate against the tool's argsSchema. Spec §3 pin: "Every
// parameter typed, bounded."
//
// Pure — no Prisma, no fs. Tested directly in src/actions/m8-tools.test.ts.

import type { JsonSchemaObject, JsonSchemaProp } from "./types";

export type ValidateResult =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; error: string };

/** Validate a caller-supplied args object against a tool's top-level object schema. */
export function validateArgs(
  schema: JsonSchemaObject,
  raw: unknown
): ValidateResult {
  if (schema.type !== "object") {
    return { ok: false, error: "argsSchema must be a top-level object" };
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "arguments must be a JSON object" };
  }
  const args = raw as Record<string, unknown>;

  const required = schema.required ?? [];
  for (const key of required) {
    if (!(key in args) || args[key] === null || args[key] === undefined) {
      return { ok: false, error: `missing required argument: ${key}` };
    }
  }

  for (const [key, value] of Object.entries(args)) {
    const prop = schema.properties[key];
    if (!prop) {
      return { ok: false, error: `unknown argument: ${key}` };
    }
    const err = validateProp(key, value, prop);
    if (err) return { ok: false, error: err };
  }

  return { ok: true, value: args };
}

function validateProp(path: string, value: unknown, prop: JsonSchemaProp): string | null {
  if (value === null || value === undefined) return null; // required already checked

  switch (prop.type) {
    case "string": {
      if (typeof value !== "string") return `${path} must be a string`;
      if (prop.minLength !== undefined && value.length < prop.minLength) {
        return `${path} must be at least ${prop.minLength} chars`;
      }
      if (prop.maxLength !== undefined && value.length > prop.maxLength) {
        return `${path} must be at most ${prop.maxLength} chars`;
      }
      if (prop.enum && !prop.enum.includes(value)) {
        return `${path} must be one of ${prop.enum.join(", ")}`;
      }
      return null;
    }
    case "number":
    case "integer": {
      if (typeof value !== "number" || Number.isNaN(value)) return `${path} must be a number`;
      if (prop.type === "integer" && !Number.isInteger(value)) return `${path} must be an integer`;
      if (prop.minimum !== undefined && value < prop.minimum) {
        return `${path} must be at least ${prop.minimum}`;
      }
      if (prop.maximum !== undefined && value > prop.maximum) {
        return `${path} must be at most ${prop.maximum}`;
      }
      if (prop.enum && !prop.enum.includes(value)) {
        return `${path} must be one of ${prop.enum.join(", ")}`;
      }
      return null;
    }
    case "boolean": {
      if (typeof value !== "boolean") return `${path} must be a boolean`;
      return null;
    }
    case "array": {
      if (!Array.isArray(value)) return `${path} must be an array`;
      if (prop.items) {
        for (let i = 0; i < value.length; i++) {
          const err = validateProp(`${path}[${i}]`, value[i], prop.items);
          if (err) return err;
        }
      }
      return null;
    }
    case "object": {
      if (value === null || typeof value !== "object" || Array.isArray(value)) {
        return `${path} must be an object`;
      }
      const obj = value as Record<string, unknown>;
      const req = prop.required ?? [];
      for (const k of req) {
        if (!(k in obj) || obj[k] === null || obj[k] === undefined) {
          return `${path}.${k} is required`;
        }
      }
      if (prop.properties) {
        for (const [k, v] of Object.entries(obj)) {
          const inner = prop.properties[k];
          if (!inner) return `${path} has unknown property: ${k}`;
          const err = validateProp(`${path}.${k}`, v, inner);
          if (err) return err;
        }
      }
      return null;
    }
  }
}

/**
 * Coerce a stored `Json` value into JsonSchemaObject at read time.
 * Returns null when the stored schema is malformed — the executor
 * treats that as "tool disabled" rather than throwing.
 */
export function readSchema(raw: unknown): JsonSchemaObject | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as { type?: unknown; properties?: unknown };
  if (obj.type !== "object") return null;
  if (!obj.properties || typeof obj.properties !== "object") return null;
  return raw as JsonSchemaObject;
}
