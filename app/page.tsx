import MagisWidget from "../components/magis-widget";
import { LandingCta } from "../components/landing/landing-cta";
import { LandingDemo } from "../components/landing/landing-demo";
import { LandingFaq } from "../components/landing/landing-faq";
import { LandingFeatures } from "../components/landing/landing-features";
import { LandingFooter } from "../components/landing/landing-footer";
import { LandingHero } from "../components/landing/landing-hero";
import { LandingHowItWorks } from "../components/landing/landing-how-it-works";
import { LandingJsonLd } from "../components/landing/landing-json-ld";
import { LandingMagisSection } from "../components/landing/landing-magis-section";
import { LandingNav } from "../components/landing/landing-nav";
import { LandingPricing } from "../components/landing/landing-pricing";
import { LandingSocialProof } from "../components/landing/landing-social-proof";
import { LandingStats } from "../components/landing/landing-stats";
import { SkipLink } from "../components/landing/skip-link";
import { StickyCta } from "../components/landing/sticky-cta";

export default function HomePage() {
  return (
    <>
      <LandingJsonLd />
      <SkipLink />

      <div className="min-h-screen bg-white font-sans">
        <LandingNav />

        <main id="conteudo-principal">
          <LandingHero />
          <LandingStats />
          <LandingMagisSection />
          <LandingHowItWorks />
          <LandingDemo />
          <LandingFeatures />
          <LandingSocialProof />
          <LandingPricing />
          <LandingFaq />
          <LandingCta />
        </main>

        <LandingFooter />
      </div>

      <MagisWidget />
      <StickyCta />
    </>
  );
}
