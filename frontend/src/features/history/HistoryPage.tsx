import { Clock } from "lucide-react";
import { ComingSoon } from "../../components/shared/ComingSoon";

export function HistoryPage() {
  return (
    <ComingSoon
      icon={Clock}
      title="Your analysis history, in one thread."
      description="A full, searchable timeline of every APK you've analyzed — with findings diffs between builds, score trends, and one-click rollback to any past report."
      eyebrow="Available in Q2"
    />
  );
}
