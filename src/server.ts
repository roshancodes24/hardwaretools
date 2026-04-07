import "dotenv/config";
import express from "express";
import cors from "cors";

import productRoutes from "./routes/products";
import purchaseRoutes from "./routes/purchases";
import saleRoutes from "./routes/sales";
import sessionRoutes from "./routes/session";
import stockAdjustmentRoutes from "./routes/stock-adjustments";
import supplierRoutes from "./routes/suppliers";
import promotionRoutes from "./routes/promotions";

const app = express();
const PORT = Number(process.env.PORT || 4000);

app.use(cors());
app.use(express.json());

app.get("/", (_req, res) => {
  res.json({
    message: "Hardware Inventory API is running",
  });
});

app.use("/api/products", productRoutes);
app.use("/api/purchases", purchaseRoutes);
app.use("/api/sales", saleRoutes);
app.use("/api/session", sessionRoutes);
app.use("/api/stock-adjustments", stockAdjustmentRoutes);
app.use("/api/suppliers", supplierRoutes);
app.use("/api/promotions", promotionRoutes);

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
