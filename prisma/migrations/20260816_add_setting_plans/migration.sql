-- CreateTable
CREATE TABLE "SettingPlan" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SettingPlan_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SettingPlan_clinicId_idx" ON "SettingPlan"("clinicId");

-- CreateIndex
CREATE UNIQUE INDEX "SettingPlan_clinicId_name_key" ON "SettingPlan"("clinicId", "name");

-- AddForeignKey
ALTER TABLE "SettingPlan" ADD CONSTRAINT "SettingPlan_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE CASCADE ON UPDATE CASCADE;
