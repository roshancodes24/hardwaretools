import cron, { type ScheduledTask } from "node-cron";
import { defaultReportCronExpression } from "../lib/reportScheduleSlots";
import { runDueScheduledReports } from "../services/scheduledReports";

let cronTask: ScheduledTask | null = null;
let startupCatchUpDone = false;

function schedulerEnabled(): boolean {
  const raw = (process.env.REPORT_SCHEDULER_ENABLED ?? "").trim();
  if (raw === "1" || raw.toLowerCase() === "true") return true;
  if (raw === "0" || raw.toLowerCase() === "false") return false;
  return process.env.NODE_ENV === "production";
}

async function runJob(label: string): Promise<void> {
  try {
    await runDueScheduledReports();
  } catch (error) {
    console.error(`[reportScheduler] ${label} failed:`, error);
  }
}

export function startReportScheduler(): void {
  if (!schedulerEnabled()) {
    console.log("[reportScheduler] Disabled (set REPORT_SCHEDULER_ENABLED=1 to enable).");
    return;
  }

  const expression = (process.env.REPORT_CRON_IST ?? defaultReportCronExpression()).trim();

  if (!startupCatchUpDone) {
    startupCatchUpDone = true;
    void runJob("startup catch-up");
  }

  if (cronTask) {
    cronTask.stop();
  }

  cronTask = cron.schedule(
    expression,
    () => {
      void runJob("cron tick");
    },
    { timezone: "Asia/Kolkata" }
  );

  console.log(
    `[reportScheduler] Started (IST cron: ${expression}, timezone: Asia/Kolkata, 30 min stagger between report types).`
  );
}

export function stopReportScheduler(): void {
  if (cronTask) {
    cronTask.stop();
    cronTask = null;
  }
}
