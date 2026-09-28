import nodemailer from "nodemailer";

function smtpHost(): string {
  return (process.env.SMTP_HOST ?? "").trim();
}

export function isEmailConfigured(): boolean {
  return smtpHost().length > 0;
}

function buildTransport() {
  const host = smtpHost();
  if (!host) return null;

  const port = Number.parseInt(process.env.SMTP_PORT ?? "587", 10);
  const user = (process.env.SMTP_USER ?? "").trim();
  const pass = (process.env.SMTP_PASS ?? "").trim();
  const secure = process.env.SMTP_SECURE === "1" || port === 465;

  return nodemailer.createTransport({
    host,
    port: Number.isFinite(port) ? port : 587,
    secure,
    auth: user ? { user, pass } : undefined,
  });
}

function appPublicUrl(): string {
  const raw = (process.env.APP_PUBLIC_URL ?? "").trim();
  if (raw) return raw.replace(/\/+$/, "");
  const port = process.env.PORT ?? "4000";
  return `http://localhost:${port}`;
}

export async function sendReportReadyEmail(input: {
  to: string;
  runId: string;
  reportTypeLabel: string;
  periodLabel: string;
  frequencyLabel: string;
  generatedAt: Date;
}): Promise<boolean> {
  const transport = buildTransport();
  if (!transport) return false;

  const from =
    (process.env.SMTP_FROM ?? "").trim() ||
    "Raj Hardware Reports <noreply@localhost>";
  const link = `${appPublicUrl()}/?reportRun=${encodeURIComponent(input.runId)}`;
  const when = input.generatedAt.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    dateStyle: "medium",
    timeStyle: "short",
  });

  const text = [
    "A scheduled owner report is ready for review.",
    "",
    `Report: ${input.reportTypeLabel}`,
    `Frequency: ${input.frequencyLabel}`,
    `Period: ${input.periodLabel}`,
    `Generated: ${when} (IST)`,
    "",
    `View in the app: ${link}`,
    "",
    "You must sign in as an admin to open the report.",
  ].join("\n");

  try {
    await transport.sendMail({
      from,
      to: input.to,
      subject: `Report ready: ${input.reportTypeLabel} (${input.periodLabel})`,
      text,
    });
    return true;
  } catch (error) {
    console.error("[email] Failed to send report notification:", error);
    return false;
  }
}
