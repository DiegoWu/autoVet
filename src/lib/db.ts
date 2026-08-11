import { PrismaClient } from "@/generated/prisma/client";

type PrismaGlobal = typeof globalThis & {
  __autoVetPrisma?: Promise<PrismaClient>;
};

const globalForPrisma = globalThis as PrismaGlobal;

function isAccelerateUrl(url: string): boolean {
  return url.startsWith("prisma://") || url.startsWith("prisma+postgres://");
}

async function createPrismaClient(): Promise<PrismaClient> {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is required when the database is first accessed.",
    );
  }

  if (isAccelerateUrl(connectionString)) {
    return new PrismaClient({ accelerateUrl: connectionString });
  }

  try {
    // Prisma 7 requires a driver adapter for direct PostgreSQL connections.
    // Keeping this import lazy makes build-time module evaluation independent
    // of DATABASE_URL and gives deployments using Accelerate no pg dependency.
    const { PrismaPg } = (await import("@prisma/adapter-pg")) as {
      PrismaPg: new (options: { connectionString: string }) => unknown;
    };
    const adapter = new PrismaPg({ connectionString });
    return new PrismaClient({ adapter: adapter as never });
  } catch (error) {
    throw new Error(
      "A direct PostgreSQL DATABASE_URL requires @prisma/adapter-pg with Prisma 7.",
      { cause: error },
    );
  }
}

/**
 * Lazily creates one Prisma client per server process. Database configuration
 * is deliberately checked on first use, not at module import/build time.
 */
export function getPrisma(): Promise<PrismaClient> {
  if (!globalForPrisma.__autoVetPrisma) {
    globalForPrisma.__autoVetPrisma = createPrismaClient().catch((error) => {
      delete globalForPrisma.__autoVetPrisma;
      throw error;
    });
  }

  return globalForPrisma.__autoVetPrisma;
}

export type DatabaseClient = Awaited<ReturnType<typeof getPrisma>>;

