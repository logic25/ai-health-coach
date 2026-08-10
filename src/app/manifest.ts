import type { MetadataRoute } from "next";

// Makes the app installable on the phone: open the deployed URL in the
// browser and use "Add to Home Screen" — it launches full-screen like a
// native app.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Coach",
    short_name: "Coach",
    description: "Personal AI health & fitness coach",
    start_url: "/",
    display: "standalone",
    background_color: "#0c0f14",
    theme_color: "#0c0f14",
    icons: [
      { src: "/icon.png", sizes: "512x512", type: "image/png" },
      { src: "/apple-icon.png", sizes: "180x180", type: "image/png" },
    ],
  };
}
