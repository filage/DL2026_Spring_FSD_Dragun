import jwt from "jsonwebtoken";

export type JwtPayload = {
  sub: string;
  role: "USER" | "ADMIN";
};

function getJwtSecret() {
  const secret = process.env["JWT_SECRET"];
  if (!secret) throw new Error("JWT_SECRET is not set");
  return secret;
}

export function signAccessToken(payload: JwtPayload) {
  const secret = getJwtSecret();
  return jwt.sign(payload, secret, { expiresIn: "7d" });
}

export function verifyAccessToken(token: string) {
  const secret = getJwtSecret();
  return jwt.verify(token, secret) as JwtPayload;
}
