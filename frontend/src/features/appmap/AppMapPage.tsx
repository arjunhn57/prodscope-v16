import { Map } from "lucide-react";
import { ComingSoon } from "../../components/shared/ComingSoon";

export function AppMapPage() {
  return (
    <ComingSoon
      icon={Map}
      title="Every screen, every path — mapped."
      description="An interactive navigation graph of your app. Click any node to inspect the screen, trace user journeys, and spot dead-ends or unreachable surfaces at a glance."
      eyebrow="Available in Q2"
    />
  );
}
