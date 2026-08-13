import path from "node:path";

function pointer(pathValue) {
  return pathValue || "/";
}

function typeMatches(value, type) {
  if (type === "null") return value === null;
  if (type === "array") return Array.isArray(value);
  if (type === "object") return value !== null && typeof value === "object" && !Array.isArray(value);
  if (type === "integer") return Number.isInteger(value);
  if (type === "number") return typeof value === "number" && Number.isFinite(value);
  return typeof value === type;
}

function validDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function validDateTime(value) {
  if (typeof value !== "string") return false;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return false;
  return Number.isFinite(Date.parse(value));
}

function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}

function buildRegistry(rootSchema, schemas) {
  const registry = new Map();
  for (const schema of [rootSchema, ...(schemas || [])]) {
    if (!schema || typeof schema !== "object") continue;
    if (schema.$id) {
      registry.set(schema.$id, schema);
      try {
        const url = new URL(schema.$id);
        registry.set(path.posix.basename(url.pathname), schema);
      } catch {
        registry.set(path.posix.basename(schema.$id), schema);
      }
    }
  }
  return registry;
}

function resolveRef(ref, registry) {
  if (registry.has(ref)) return registry.get(ref);
  const basename = path.posix.basename(ref);
  return registry.get(basename) || null;
}

function validateNode(value, schema, currentPath, registry, issues) {
  if (!schema || typeof schema !== "object") return;

  if (schema.$ref) {
    const target = resolveRef(schema.$ref, registry);
    if (!target) {
      issues.push({ path: pointer(currentPath), keyword: "$ref", message: `Unresolved schema reference: ${schema.$ref}` });
      return;
    }
    validateNode(value, target, currentPath, registry, issues);
    return;
  }

  if (Array.isArray(schema.anyOf)) {
    const valid = schema.anyOf.some((candidate) => {
      const branchIssues = [];
      validateNode(value, candidate, currentPath, registry, branchIssues);
      return branchIssues.length === 0;
    });
    if (!valid) issues.push({ path: pointer(currentPath), keyword: "anyOf", message: "Value does not match any allowed schema" });
    return;
  }

  if (Object.hasOwn(schema, "const") && !Object.is(value, schema.const)) {
    issues.push({ path: pointer(currentPath), keyword: "const", message: `Expected constant value ${JSON.stringify(schema.const)}` });
    return;
  }

  if (Array.isArray(schema.enum) && !schema.enum.some((item) => Object.is(item, value))) {
    issues.push({ path: pointer(currentPath), keyword: "enum", message: `Value must be one of: ${schema.enum.join(", ")}` });
    return;
  }

  if (schema.type) {
    const allowed = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!allowed.some((type) => typeMatches(value, type))) {
      issues.push({ path: pointer(currentPath), keyword: "type", message: `Expected type: ${allowed.join(" | ")}` });
      return;
    }
  }

  if (typeof value === "string") {
    if (Number.isInteger(schema.minLength) && value.length < schema.minLength) {
      issues.push({ path: pointer(currentPath), keyword: "minLength", message: `String must contain at least ${schema.minLength} characters` });
    }
    if (schema.pattern && !(new RegExp(schema.pattern).test(value))) {
      issues.push({ path: pointer(currentPath), keyword: "pattern", message: `String does not match ${schema.pattern}` });
    }
    if (schema.format === "date" && !validDate(value)) {
      issues.push({ path: pointer(currentPath), keyword: "format", message: "Expected RFC 3339 full-date" });
    }
    if (schema.format === "date-time" && !validDateTime(value)) {
      issues.push({ path: pointer(currentPath), keyword: "format", message: "Expected RFC 3339 date-time" });
    }
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    if (Number.isFinite(schema.minimum) && value < schema.minimum) {
      issues.push({ path: pointer(currentPath), keyword: "minimum", message: `Value must be >= ${schema.minimum}` });
    }
    if (Number.isFinite(schema.maximum) && value > schema.maximum) {
      issues.push({ path: pointer(currentPath), keyword: "maximum", message: `Value must be <= ${schema.maximum}` });
    }
  }

  if (Array.isArray(value)) {
    if (Number.isInteger(schema.minItems) && value.length < schema.minItems) {
      issues.push({ path: pointer(currentPath), keyword: "minItems", message: `Array must contain at least ${schema.minItems} items` });
    }
    if (schema.uniqueItems === true) {
      const seen = new Set();
      for (const item of value) {
        const key = stableStringify(item);
        if (seen.has(key)) {
          issues.push({ path: pointer(currentPath), keyword: "uniqueItems", message: "Array items must be unique" });
          break;
        }
        seen.add(key);
      }
    }
    if (schema.items) {
      value.forEach((item, index) => validateNode(item, schema.items, `${currentPath}/${index}`, registry, issues));
    }
  }

  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const properties = schema.properties || {};
    for (const required of schema.required || []) {
      if (!Object.hasOwn(value, required)) {
        issues.push({ path: pointer(currentPath), keyword: "required", message: `Missing required property: ${required}` });
      }
    }
    for (const [key, child] of Object.entries(value)) {
      if (Object.hasOwn(properties, key)) {
        validateNode(child, properties[key], `${currentPath}/${key}`, registry, issues);
      } else if (schema.additionalProperties === false) {
        issues.push({ path: pointer(`${currentPath}/${key}`), keyword: "additionalProperties", message: `Unexpected property: ${key}` });
      }
    }
  }
}

export function validateJsonSchema(value, schema, options = {}) {
  const registry = buildRegistry(schema, options.schemas || []);
  const issues = [];
  validateNode(value, schema, "", registry, issues);
  return { valid: issues.length === 0, issues };
}
