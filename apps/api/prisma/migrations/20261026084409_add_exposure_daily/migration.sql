-- CreateTable
CREATE TABLE "ExposureDaily" (
    "id" UUID NOT NULL,
    "taskId" UUID NOT NULL,
    "promoterId" UUID NOT NULL,
    "statDate" VARCHAR(10) NOT NULL,
    "exposureCount" INTEGER NOT NULL,
    "clickCount" INTEGER NOT NULL,
    "conversionCount" INTEGER NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExposureDaily_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExposureDaily_promoterId_statDate_idx" ON "ExposureDaily"("promoterId", "statDate");

-- CreateIndex
CREATE INDEX "ExposureDaily_taskId_statDate_idx" ON "ExposureDaily"("taskId", "statDate");

-- CreateIndex
CREATE UNIQUE INDEX "ExposureDaily_taskId_promoterId_statDate_key" ON "ExposureDaily"("taskId", "promoterId", "statDate");

-- AddForeignKey
ALTER TABLE "ExposureDaily" ADD CONSTRAINT "ExposureDaily_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExposureDaily" ADD CONSTRAINT "ExposureDaily_promoterId_fkey" FOREIGN KEY ("promoterId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
