import "dotenv/config";
import fs from "fs";
import path from "path";
import express from "express";
import cors from "cors";

import { buildCorsOptions } from "./lib/corsOptions";
import {
  parseProductListQuery,
  productSearchWhere,
  resolveProductListPaging,
  wantsPaginatedProductList,
} from "./lib/productListQuery";
import { actingUserMiddleware } from "./middleware/actingUser";
import { errorHandler, requestLogger } from "./middleware/httpMiddleware";
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

/** Large enough for bulk product/purchase imports (~1500 rows). Default Express limit is 100kb. */
const JSON_BODY_LIMIT = process.env.JSON_BODY_LIMIT ?? "15mb";

/** Express app without listening — used by `server.ts` and API regression tests. */
export function buildApp(): express.Express {
  const app = express();

  app.use(cors(buildCorsOptions()));
  app.use(requestLogger());
  app.use(express.json({ limit: JSON_BODY_LIMIT }));

  app.use("/api/login", authLoginRoutes);
  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, message: "Inventory API is running" });
  });
  app.use("/api", actingUserMiddleware);

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

  const staticRoot = path.resolve(
    process.env.FRONTEND_DIST ?? path.join(__dirname, "..", "frontend", "dist")
  );
  const distIndex = path.join(staticRoot, "index.html");
  const serveFrontend =
    process.env.SERVE_FRONTEND === "1" ||
    (process.env.NODE_ENV === "production" && fs.existsSync(distIndex));

  if (serveFrontend) {
    app.use(express.static(staticRoot));
    app.use((req, res, next) => {
      if (req.path.startsWith("/api")) return next();
      if (req.method !== "GET" && req.method !== "HEAD") return next();
      res.sendFile(distIndex);
    });
  } else {
    app.get("/", (_req, res) => {
      res.json({
        message: "Inventory API is running",
      });
    });
  }

  app.use(errorHandler);

  return app;
}
