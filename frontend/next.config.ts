import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",

  /**
   * firebase-admin uses dynamic requires and native-adjacent transports
   * that a bundler cannot trace correctly. Next.js already carries it on
   * an internal auto-opt-out list, so this entry is belt-and-braces rather
   * than strictly required today -- but that list is Next's to change, and
   * the failure mode if it ever does is a runtime module-resolution error
   * inside a deployed container, not a build error anyone would catch
   * first. Naming it here costs nothing and removes the dependency on
   * someone else's list.
   *
   * Note this is the stable top-level option, not the Next 14-era
   * experimental.serverComponentsExternalPackages.
   */
  serverExternalPackages: ["firebase-admin"],
};

export default nextConfig;
