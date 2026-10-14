/**
 * Security headers and Content Security Policy generator.
 * Strictly adheres to principle of least privilege.
 * Never includes 'unsafe-eval' in production environments.
 */

export interface CSPConfig {
  isDev?: boolean;
}

export function buildContentSecurityPolicy(config: CSPConfig = {}): string {
  const isDev = config.isDev ?? process.env.NODE_ENV === "development";

  const directives: string[] = [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data: https:",
    "media-src 'self' blob: https://*.supabase.co",
    "font-src 'self' data:",
    `connect-src 'self' https:${isDev ? " ws: wss:" : ""}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ];

  if (!isDev) {
    directives.push("upgrade-insecure-requests");
  }

  return directives.join("; ");
}

export function getSecurityHeaders(config: CSPConfig = {}) {
  const isDev = config.isDev ?? process.env.NODE_ENV === "development";

  const csp = buildContentSecurityPolicy({ isDev });

  const headers = [
    {
      key: "Content-Security-Policy",
      value: csp,
    },
    {
      key: "X-Content-Type-Options",
      value: "nosniff",
    },
    {
      key: "X-Frame-Options",
      value: "DENY",
    },
    {
      key: "Referrer-Policy",
      value: "strict-origin-when-cross-origin",
    },
    {
      key: "Permissions-Policy",
      value: "camera=(), microphone=(), geolocation=(), browsing-topics=()",
    },
  ];

  if (!isDev) {
    headers.push({
      key: "Strict-Transport-Security",
      value: "max-age=63072000; includeSubDomains; preload",
    });
  }

  return headers;
}
