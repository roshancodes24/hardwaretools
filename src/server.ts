import "dotenv/config";
import { buildApp } from "./app";
import { startReportScheduler } from "./jobs/reportScheduler";

const app = buildApp();
const PORT = Number(process.env.PORT || 4000);

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  startReportScheduler();
});
