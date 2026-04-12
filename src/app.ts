import "dotenv/config";
import express from "express";
import cors from "cors";

import { actingUserMiddleware } from "./middleware/actingUser";
import authLoginRoutes from "./routes/auth-login";
import productRoutes from "./routes/products";
import purchaseRoutes from "./routes/purchases";
import saleRoutes from "./routes/sales";
import sessionRoutes from "./routes/session";
import stockAdjustmentRoutes from "./routes/stock-adjustments";
import supplierRoutes from "./routes/suppliers";
import customerRoutes from "./routes/customers";
import promotionRoutes from "./routes/promotions";
import reportRoutes from "./routes/reports";

/** Express app without listening — used by `server.ts` and API regression tests. */
export function buildApp(): express.Express {
  const app = express();

  app.use(cors());
  app.use(express.json());

  app.use("/api/login", authLoginRoutes);
  app.use("/api", actingUserMiddleware);

  app.get("/", (_req, res) => {
    res.json({
      message: "Inventory API is running",
    });
  });

  app.use("/api/products", productRoutes);
  app.use("/api/purchases", purchaseRoutes);
  app.use("/api/sales", saleRoutes);
  app.use("/api/session", sessionRoutes);
  app.use("/api/stock-adjustments", stockAdjustmentRoutes);
  app.use("/api/suppliers", supplierRoutes);
  app.use("/api/customers", customerRoutes);
  app.use("/api/promotions", promotionRoutes);
  app.use("/api/reports", reportRoutes);

  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "Not found" });
  });

  return app;
}
