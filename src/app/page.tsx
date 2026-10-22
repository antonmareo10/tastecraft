import TastecraftApp from "@/components/TastecraftApp";
import { DEMOS, demoSummaries } from "@/data/demos";
import { byContrast, flipOf, type QlooFlip } from "@/lib/flip";

export default function Home() {
  // The "switch Qloo off" card: every recorded run with a scored no-Qloo answer, the sharpest contrast first.
  const flips = DEMOS.map(flipOf)
    .filter((f): f is QlooFlip => f != null)
    .sort(byContrast);
  return <TastecraftApp demos={demoSummaries()} flips={flips} />;
}
