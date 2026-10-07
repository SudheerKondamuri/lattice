import type { Metadata } from "next";
import { Marketing } from "@/components/marketing";

export const metadata: Metadata = {
  title: { absolute: "Lattice — Support that shows its work." },
  description:
    "Import trusted knowledge, inspect the evidence, test corrections, and publish customer support answers with confidence.",
};

export default function HomePage() {
  return <Marketing />;
}
