import { defineConfig } from "deepsec/config";

export default defineConfig({
  projects: [
    { id: "opencode", root: ".." },
    // <deepsec:projects-insert-above>
  ],
});
