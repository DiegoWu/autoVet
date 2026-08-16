import {NextResponse} from "next/server";
import {z} from "zod";
import {Prisma} from "@/generated/prisma/client";
import {requireSession} from "@/lib/auth";
import {getPrisma} from "@/lib/db";
import {settingPlanPayloadSchema} from "@/lib/setting-plan";

const UpdateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  payload: settingPlanPayloadSchema.optional(),
}).refine((value) => value.name !== undefined || value.payload !== undefined, {
  message: "No updates supplied",
});

export async function PUT(
  request: Request,
  context: {params: Promise<{id: string}>},
) {
  const session = await requireSession(request);
  if (!session) return NextResponse.json({error: "Unauthorized"}, {status: 401});
  const {id} = await context.params;
  const parsed = UpdateSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({error: "Invalid setting plan", issues: parsed.error.issues}, {status: 400});
  }
  try {
    const prisma = await getPrisma();
    const existing = await prisma.settingPlan.findFirst({
      where: {id, clinicId: session.clinicId},
      select: {id: true},
    });
    if (!existing) return NextResponse.json({error: "Not found"}, {status: 404});
    const plan = await prisma.settingPlan.update({
      where: {id},
      data: {
        ...(parsed.data.name ? {name: parsed.data.name} : {}),
        ...(parsed.data.payload
          ? {payload: parsed.data.payload as Prisma.InputJsonValue}
          : {}),
      },
      select: {id: true, name: true, payload: true, updatedAt: true},
    });
    return NextResponse.json(plan);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json({error: "A plan with this name already exists"}, {status: 409});
    }
    return NextResponse.json({error: "Setting plans are unavailable"}, {status: 503});
  }
}

export async function DELETE(
  _request: Request,
  context: {params: Promise<{id: string}>},
) {
  const session = await requireSession(_request);
  if (!session) return NextResponse.json({error: "Unauthorized"}, {status: 401});
  const {id} = await context.params;
  try {
    const prisma = await getPrisma();
    const existing = await prisma.settingPlan.findFirst({
      where: {id, clinicId: session.clinicId},
      select: {id: true},
    });
    if (!existing) return NextResponse.json({error: "Not found"}, {status: 404});
    await prisma.settingPlan.delete({where: {id}});
    return NextResponse.json({ok: true});
  } catch {
    return NextResponse.json({error: "Setting plans are unavailable"}, {status: 503});
  }
}
