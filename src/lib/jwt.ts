import jwt from "jsonwebtoken";

export function jwtSecret(): string {
  const s = process.env.JWT_SECRET?.trim();
  if (!s && process.env.NODE_ENV === "production") {
    throw new Error("JWT_SECRET is required in production");
  }
  return s ?? "dev-jwt-secret-change-in-production";
}

export function signAccessToken(userId: string): string {
  return jwt.sign({ sub: userId }, jwtSecret(), { expiresIn: "7d" });
}

export function verifyAccessToken(token: string): { sub: string } {
  const decoded = jwt.verify(token, jwtSecret()) as jwt.JwtPayload;
  const sub = decoded.sub;
  if (typeof sub !== "string" || !sub.trim()) {
    throw new Error("Invalid token payload");
  }
  return { sub: sub.trim() };
}
