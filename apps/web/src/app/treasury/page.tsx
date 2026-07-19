import Link from "next/link";
import { Treasury } from "@/components/Treasury";

export default function TreasuryPage() {
  return (
    <div>
      <div className="mx-auto max-w-2xl px-4 pt-4">
        <Link href="/" className="font-mono text-[13px] text-brass">
          ← Back to the Realm
        </Link>
      </div>
      <Treasury />
    </div>
  );
}
