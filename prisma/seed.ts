import "dotenv/config";
import {PrismaPg} from "@prisma/adapter-pg";
import {PrismaClient} from "../src/generated/prisma/client";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required to seed autoVet.");

const prisma = new PrismaClient({adapter: new PrismaPg({connectionString})});

async function main() {
  const clinic = await prisma.clinic.upsert({
    where: {id: "demo-clinic"},
    update: {},
    create: {
      id: "demo-clinic",
      name: "好朋友動物醫院",
      defaultLocale: "zh-TW",
      minDoctors: 1,
      minNurses: 1,
      maxNurses: 4,
    },
  });

  const people = [
    {id: "demo-doctor-1", name: "張嘉欣", role: "DOCTOR" as const, targetWeeklyHours: 40, yearsExperience: 8, expertise: "內科、預防醫學", hobbies: "登山、攝影", sortOrder: 1},
    {id: "demo-doctor-2", name: "蔡靜文", role: "DOCTOR" as const, targetWeeklyHours: 32, yearsExperience: 5, expertise: "犬貓一般診療", hobbies: "閱讀", sortOrder: 2},
    {id: "demo-nurse-1", name: "廖慧玲", role: "NURSE" as const, targetWeeklyHours: 40, yearsExperience: 6, expertise: "住院與術後照護", hobbies: "烘焙", sortOrder: 3},
    {id: "demo-nurse-2", name: "陳怡安", role: "NURSE" as const, targetWeeklyHours: 32, yearsExperience: 3, expertise: "門診與衛教", hobbies: "慢跑", sortOrder: 4},
  ];

  for (const person of people) {
    await prisma.employee.upsert({
      where: {id: person.id},
      update: person,
      create: {...person, clinicId: clinic.id},
    });
  }

  await prisma.coworkerPreference.upsert({
    where: {fromId_toId: {fromId: "demo-doctor-1", toId: "demo-nurse-1"}},
    update: {weight: 2, note: "手術日合作順暢"},
    create: {fromId: "demo-doctor-1", toId: "demo-nurse-1", weight: 2, note: "手術日合作順暢"},
  });
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
