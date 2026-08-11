import { Prisma } from "@/generated/prisma/client";

export function toUtcDate(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

export function monthBounds(month: string): { gte: Date; lt: Date } {
  const [year, monthNumber] = month.split("-").map(Number);
  return {
    gte: new Date(Date.UTC(year, monthNumber - 1, 1)),
    lt: new Date(Date.UTC(year, monthNumber, 1)),
  };
}

export function immutableJson(
  value: unknown,
): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  const clone = structuredClone(value);
  return clone === null
    ? Prisma.JsonNull
    : (clone as Prisma.InputJsonValue);
}

export class DataConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DataConflictError";
  }
}

export class DataNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DataNotFoundError";
  }
}

