import { NextFunction, Request, Response } from "express";

/** Browser protection shared by production bootstrap and HTTP security tests. */
export function securityHeaders(request: Request, response: Response, next: NextFunction) {
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  const dashboard = request.path === "/" || /^\/[^/]+\/configure\/?$/.test(request.path);
  response.setHeader("Content-Security-Policy", [
    "frame-ancestors 'none'", "base-uri 'self'", "form-action 'self'", "object-src 'none'",
    ...(dashboard ? ["script-src 'self'"] : []),
  ].join("; "));
  if (dashboard || /^\/(admin|auth|setup|settings|name|folders|channels|telegram-status|invitations|cache)(\/|$)/.test(request.path)) {
    response.setHeader("Cache-Control", "no-store");
  }
  next();
}
