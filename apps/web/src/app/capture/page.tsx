import { redirect } from "next/navigation";
import { requireUser } from "@/server/auth";
import { CaptureForm } from "./form";

export const dynamic = "force-dynamic";

export default async function CapturePage() {
  const user = await requireUser();
  if (user.role !== "subject") redirect("/");
  return (
    <>
      <h1>Capture</h1>
      <p className="sub">
        Upload a story — a .txt/.md written memory, or an audio file (mock-transcribed unless a
        real ASR key is configured). Originals are checksummed and immutable.
      </p>
      <CaptureForm />
    </>
  );
}
