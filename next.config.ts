import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    return [{source:"/(.*)",headers:[
      {key:"Content-Security-Policy",value:"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"},
      {key:"Referrer-Policy",value:"strict-origin-when-cross-origin"},
      {key:"X-Content-Type-Options",value:"nosniff"},
      {key:"X-Frame-Options",value:"DENY"},
      {key:"Permissions-Policy",value:"camera=(), microphone=(), geolocation=(), payment=()"},
      {key:"Cross-Origin-Opener-Policy",value:"same-origin"},
      {key:"Cross-Origin-Resource-Policy",value:"same-origin"},
    ]}];
  },
};

export default nextConfig;
