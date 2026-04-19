import { useEffect, type CSSProperties } from "react";
import Lenis from "lenis";
import { NavBar } from "./components/NavBar";
import { Hero } from "./components/Hero";
import { MetricsStrip } from "./components/MetricsStrip";
import { ScrollDemo } from "./components/ScrollDemo";
import { FeatureTabs } from "./components/FeatureTabs";
import { HowItWorks } from "./components/HowItWorks";
import { ReportPreview } from "./components/ReportPreview";
import { Pricing } from "./components/Pricing";
import { FinalCTA } from "./components/FinalCTA";
import { Footer } from "./components/Footer";

const SHOWCASE_BG: CSSProperties = {
  background: [
    "radial-gradient(ellipse 60% 25% at 85% 8%, rgba(124, 58, 237, 0.07), transparent 60%)",
    "radial-gradient(ellipse 50% 20% at 10% 35%, rgba(175, 109, 255, 0.06), transparent 55%)",
    "radial-gradient(ellipse 55% 20% at 80% 55%, rgba(219, 39, 119, 0.05), transparent 60%)",
    "radial-gradient(ellipse 50% 25% at 20% 85%, rgba(124, 58, 237, 0.06), transparent 55%)",
    "linear-gradient(180deg, #F8F7FF 0%, #FAFAFA 25%, #FFFFFF 50%, #FAFAFA 75%, #F8F7FF 100%)",
  ].join(", "),
  contentVisibility: "auto",
  containIntrinsicSize: "1px 2400px",
};

const HOWITWORKS_BG: CSSProperties = {
  background: [
    "radial-gradient(ellipse 55% 20% at 10% 75%, rgba(175, 109, 255, 0.40), transparent 60%)",
    "radial-gradient(ellipse 50% 18% at 78% 78%, rgba(255, 235, 170, 0.55), transparent 62%)",
    "radial-gradient(ellipse 50% 15% at 15% 95%, rgba(255, 100, 180, 0.40), transparent 62%)",
    "radial-gradient(ellipse 50% 15% at 92% 97%, rgba(120, 190, 255, 0.45), transparent 62%)",
    "linear-gradient(180deg, #FFFFFF 0%, #FAFAFA 20%, #f7eaff 70%, #fde2ea 100%)",
  ].join(", "),
  contentVisibility: "auto",
  containIntrinsicSize: "1px 1200px",
};

const BELOW_FOLD: CSSProperties = {
  contentVisibility: "auto",
  containIntrinsicSize: "1px 800px",
};

export function HomePage() {
  useEffect(() => {
    const lenis = new Lenis({
      duration: 1.2,
      easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      smoothWheel: true,
      touchMultiplier: 1.5,
    });

    let rafId = 0;
    const raf = (time: number) => {
      lenis.raf(time);
      rafId = requestAnimationFrame(raf);
    };
    rafId = requestAnimationFrame(raf);

    return () => {
      cancelAnimationFrame(rafId);
      lenis.destroy();
    };
  }, []);

  return (
    <div className="min-h-dvh w-full bg-bg-primary">
      <NavBar />
      <Hero />
      <MetricsStrip />
      <div style={HOWITWORKS_BG}>
        <HowItWorks />
      </div>
      <div style={SHOWCASE_BG}>
        <ScrollDemo />
        <FeatureTabs />
        <ReportPreview />
      </div>
      <div style={BELOW_FOLD}>
        <Pricing />
      </div>
      <div style={BELOW_FOLD}>
        <FinalCTA />
      </div>
      <div style={BELOW_FOLD}>
        <Footer />
      </div>
    </div>
  );
}
