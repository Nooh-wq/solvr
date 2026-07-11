// M7.5 — OpenAPI 3.1 spec for /api/v1. Hand-written (small enough that
// hand-writing beats the churn of a code-generator dependency). Kept in
// sync with the routes via the sso.test.ts-style pinning tests (M7 tests).
//
// Served at /api/v1/openapi.json — no auth required, so external
// developers can point their editors + code generators at it.

import { NextResponse } from "next/server";

const OPENAPI_DOC = {
  openapi: "3.1.0",
  info: {
    title: "Stralis Support API",
    version: "1.0.0",
    description: "REST API for tickets, users, and outbound events. Authenticated via bearer API keys (`Authorization: Bearer stralis_pk_...`).",
  },
  servers: [{ url: "https://{host}/api/v1", variables: { host: { default: "app.stralis.com" } } }],
  components: {
    securitySchemes: {
      bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "API key" },
    },
    schemas: {
      Ticket: {
        type: "object",
        required: ["reference", "ticketNumber", "title", "description", "status", "priority", "createdAt", "updatedAt"],
        properties: {
          reference: { type: "string" },
          ticketNumber: { type: "string" },
          title: { type: "string" },
          description: { type: "string" },
          status: { type: "string", enum: ["OPEN", "IN_PROGRESS", "PENDING", "RESOLVED", "CLOSED"] },
          priority: { type: "string", enum: ["LOW", "MEDIUM", "HIGH", "URGENT"] },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
          resolvedAt: { type: ["string", "null"], format: "date-time" },
        },
      },
      User: {
        type: "object",
        required: ["id", "email", "kind", "createdAt"],
        properties: {
          id: { type: "string" },
          email: { type: "string", format: "email" },
          name: { type: ["string", "null"] },
          kind: { type: "string", enum: ["TEAM_MEMBER", "END_USER"] },
          createdAt: { type: "string", format: "date-time" },
        },
      },
      Pagination: {
        type: "object",
        required: ["page", "pageSize", "total"],
        properties: {
          page: { type: "integer" },
          pageSize: { type: "integer" },
          total: { type: "integer" },
        },
      },
      Error: {
        type: "object",
        required: ["error"],
        properties: {
          error: {
            type: "object",
            required: ["code", "message"],
            properties: {
              code: { type: "string" },
              message: { type: "string" },
            },
          },
        },
      },
    },
  },
  security: [{ bearerAuth: [] }],
  paths: {
    "/tickets": {
      get: {
        summary: "List tickets",
        parameters: [
          { name: "page", in: "query", schema: { type: "integer", default: 1 } },
          { name: "pageSize", in: "query", schema: { type: "integer", default: 25, maximum: 100 } },
        ],
        responses: {
          "200": {
            description: "Paginated ticket list",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    data: { type: "array", items: { $ref: "#/components/schemas/Ticket" } },
                    pagination: { $ref: "#/components/schemas/Pagination" },
                  },
                },
              },
            },
          },
          "401": { description: "Unauthenticated", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
          "403": { description: "Missing scope tickets:read", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        },
      },
      post: {
        summary: "Create a ticket",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["title", "description", "requesterEmail"],
                properties: {
                  title: { type: "string" },
                  description: { type: "string" },
                  priority: { type: "string", enum: ["LOW", "MEDIUM", "HIGH", "URGENT"] },
                  requesterEmail: { type: "string", format: "email" },
                  requesterName: { type: "string" },
                },
              },
            },
          },
        },
        responses: {
          "201": { description: "Created", content: { "application/json": { schema: { $ref: "#/components/schemas/Ticket" } } } },
          "400": { description: "Invalid body", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        },
      },
    },
    "/tickets/{reference}": {
      parameters: [{ name: "reference", in: "path", required: true, schema: { type: "string" } }],
      get: {
        summary: "Fetch one ticket",
        responses: {
          "200": { description: "OK", content: { "application/json": { schema: { $ref: "#/components/schemas/Ticket" } } } },
          "404": { description: "Not found", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        },
      },
      patch: {
        summary: "Update ticket fields",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  title: { type: "string" },
                  description: { type: "string" },
                  status: { type: "string", enum: ["OPEN", "IN_PROGRESS", "PENDING", "RESOLVED", "CLOSED"] },
                  priority: { type: "string", enum: ["LOW", "MEDIUM", "HIGH", "URGENT"] },
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "Updated", content: { "application/json": { schema: { $ref: "#/components/schemas/Ticket" } } } },
          "404": { description: "Not found" },
        },
      },
    },
    "/users": {
      get: {
        summary: "List users",
        parameters: [
          { name: "kind", in: "query", schema: { type: "string", enum: ["TEAM_MEMBER", "END_USER"] } },
          { name: "page", in: "query", schema: { type: "integer", default: 1 } },
          { name: "pageSize", in: "query", schema: { type: "integer", default: 25, maximum: 100 } },
        ],
        responses: {
          "200": {
            description: "Paginated user list",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    data: { type: "array", items: { $ref: "#/components/schemas/User" } },
                    pagination: { $ref: "#/components/schemas/Pagination" },
                  },
                },
              },
            },
          },
        },
      },
      post: {
        summary: "Create a user",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["email"],
                properties: {
                  email: { type: "string", format: "email" },
                  name: { type: "string" },
                  kind: { type: "string", enum: ["END_USER", "TEAM_MEMBER"], default: "END_USER" },
                  roleName: { type: "string", description: "Required when kind=TEAM_MEMBER" },
                },
              },
            },
          },
        },
        responses: {
          "201": { description: "Created", content: { "application/json": { schema: { $ref: "#/components/schemas/User" } } } },
        },
      },
    },
    "/users/{id}": {
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
      get: {
        summary: "Fetch one user",
        responses: {
          "200": { description: "OK", content: { "application/json": { schema: { $ref: "#/components/schemas/User" } } } },
          "404": { description: "Not found" },
        },
      },
      patch: {
        summary: "Update user fields",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  email: { type: "string", format: "email" },
                  roleName: { type: "string" },
                },
              },
            },
          },
        },
        responses: { "200": { description: "Updated" }, "404": { description: "Not found" } },
      },
    },
  },
};

export function GET() {
  return NextResponse.json(OPENAPI_DOC, {
    headers: { "content-type": "application/json", "access-control-allow-origin": "*" },
  });
}
