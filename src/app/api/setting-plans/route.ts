import {NextResponse} from "next/server";
import {z} from "zod";
import {Prisma} from "@/generated/prisma/client";
import {requireSession} from "@/lib/auth";
import {getPrisma} from "@/lib/db";
import {settingPlanPayloadSchema} from "@/lib/setting-plan";

const CreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  payload: settingPlanPayloadSchema,
});

export async function GET(request: Request) {
  const session = await requireSession(request);
  if (!session) return NextResponse.json({error: "Unauthorized"}, {status: 401});
  try {
    const prisma = await getPrisma();
    const plans = await prisma.settingPlan.findMany({
      where: {clinicId: session.clinicId},
      orderBy: {updatedAt: "desc"},
      select: {id: true, name: true, payload: true, updatedAt: true},
    });
    return NextResponse.json(plans);
  } catch {
    return NextResponse.json([], {status: 200});
  }
}

export async function POST(request: Request) {
  const session = await requireSession(request);
  if (!session) return NextResponse.json({error: "Unauthorized"}, {status: 401});
  const parsed = CreateSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({error: "Invalid setting plan", issues: parsed.error.issues}, {status: 400});
  }
  try {
    const prisma = await getPrisma();
    const plan = await prisma.settingPlan.create({
      data: {
        clinicId: session.clinicId,
        name: parsed.data.name,
        payload: parsed.data.payload as Prisma.InputJsonValue,
      },
      select: {id: true, name: true, payload: true, updatedAt: true},
    });
    return NextResponse.json(plan, {status: 201});
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json({error: "A plan with this name already exists"}, {status: 409});
    }
    return NextResponse.json({error: "Setting plans are unavailable"}, {status: 503});
  }
}
