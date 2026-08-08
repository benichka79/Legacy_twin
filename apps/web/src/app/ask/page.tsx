import { requireUser } from "@/server/auth";
import { AskChat } from "./chat";

export const dynamic = "force-dynamic";

export default async function AskPage() {
  const user = await requireUser();
  return (
    <>
      <h1>Ask</h1>
      <p className="sub">
        Answers come only from approved memories, with citations — anything else is an honest
        &ldquo;not recorded.&rdquo; You are asking as <span className="mono">{user.actor}</span>.
      </p>
      <AskChat />
    </>
  );
}
