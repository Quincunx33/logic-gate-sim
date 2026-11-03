import { createFileRoute } from "@tanstack/react-router";
import { LabShell } from "@/lab/LabShell";

export const Route = createFileRoute("/")({
  component: LabShell,
});
