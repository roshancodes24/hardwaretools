import "dotenv/config";
import { buildApp } from "./app";

const app = buildApp();
const PORT = Number(process.env.PORT || 4000);

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
