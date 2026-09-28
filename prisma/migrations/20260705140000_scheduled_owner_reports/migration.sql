-- CreateEnum
CREATE TYPE "ScheduledReportType" AS ENUM ('SALES', 'INVENTORY', 'SUPPLIER_OUTSTANDING', 'CUSTOMER_OUTSTANDING');

-- CreateEnum
CREATE TYPE "ReportPeriod" AS ENUM ('DAILY', 'MONTHLY', 'QUARTERLY', 'YEARLY');

-- CreateEnum
CREATE TYPE "ReportRunStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "ReportScheduleConfig" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "notifyEmail" TEXT NOT NULL DEFAULT '',
    "salesEnabled" BOOLEAN NOT NULL DEFAULT false,
    "salesPeriod" "ReportPeriod",
    "inventoryEnabled" BOOLEAN NOT NULL DEFAULT false,
    "inventoryPeriod" "ReportPeriod",
    "supplierOutstandingEnabled" BOOLEAN NOT NULL DEFAULT false,
    "supplierOutstandingPeriod" "ReportPeriod",
    "customerOutstandingEnabled" BOOLEAN NOT NULL DEFAULT false,
    "customerOutstandingPeriod" "ReportPeriod",
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReportScheduleConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportRun" (
    "id" TEXT NOT NULL,
    "reportType" "ScheduledReportType" NOT NULL,
    "period" "ReportPeriod" NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "asOf" TIMESTAMP(3) NOT NULL,
    "status" "ReportRunStatus" NOT NULL,
    "payload" JSONB,
    "errorMessage" TEXT,
    "emailSentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReportRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReportRun_createdAt_idx" ON "ReportRun"("createdAt");

-- CreateIndex
CREATE INDEX "ReportRun_reportType_status_idx" ON "ReportRun"("reportType", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ReportRun_reportType_period_periodStart_key" ON "ReportRun"("reportType", "period", "periodStart");
