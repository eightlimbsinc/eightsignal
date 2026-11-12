import { requireMember, canEdit } from "@/lib/auth";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/shared/page";
import { NewIntelligenceForms } from "./forms";

export const metadata = { title: "Add intelligence" };

export default async function NewIntelligencePage() {
  const { profile } = await requireMember();
  if (!canEdit(profile)) redirect("/intelligence");
  return (
    <>
      <PageHeader
        eyebrow="Intelligence"
        title="Add intelligence"
        description="Submit an official URL for extraction, or record a development manually. Duplicates are detected by canonical URL and content fingerprint."
      />
      <NewIntelligenceForms />
    </>
  );
}
