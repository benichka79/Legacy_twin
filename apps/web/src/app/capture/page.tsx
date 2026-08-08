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
        Answer a guided question in your own voice, write it down, or upload existing material.
        Originals are checksummed and immutable; audio is transcribed by the worker
        (mock unless a Deepgram key is configured).
      </p>
      <CaptureForm />
    </>
  );
}
