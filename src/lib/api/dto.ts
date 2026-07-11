// src/lib/api/dto.ts
//
// M7.2/M7.3 — DTO projections for API v1 responses. Keeping these
// centralized means the OpenAPI spec (M7.5) can reference a single
// source of truth rather than each route inventing its shape.
//
// Naming: fields exposed to external developers use camelCase and
// reference-based identifiers (M7 §3: "do not expose internal IDs...
// where the tenant-scoped reference should be used").

import type { Ticket, TicketStatus, Priority, TeamMember, EndUser } from "@/generated/prisma";

export type ApiTicketDto = {
  reference: string;
  ticketNumber: string;
  title: string;
  description: string;
  status: TicketStatus;
  priority: Priority;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
};

export function ticketToDto(t: Ticket): ApiTicketDto {
  return {
    reference: t.reference,
    ticketNumber: t.ticketNumber,
    title: t.title,
    description: t.description,
    status: t.status,
    priority: t.priority,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
    resolvedAt: t.resolvedAt?.toISOString() ?? null,
  };
}

export type ApiUserDto = {
  id: string;
  email: string;
  name: string | null;
  kind: "TEAM_MEMBER" | "END_USER";
  createdAt: string;
};

export function teamMemberToDto(u: TeamMember): ApiUserDto {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    kind: "TEAM_MEMBER",
    createdAt: u.createdAt.toISOString(),
  };
}

export function endUserToDto(u: EndUser): ApiUserDto {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    kind: "END_USER",
    createdAt: u.createdAt.toISOString(),
  };
}
