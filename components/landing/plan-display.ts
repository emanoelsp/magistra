import { PLANS } from "../../lib/services/plans";

export interface LandingPlan {
  id: string;
  name: string;
  badge: string;
  price: string;
  period: string;
  desc: string;
  features: readonly string[];
  href: string;
  cta: string;
  theme: "green" | "white" | "dark";
  featured: boolean;
}

export const LANDING_PLANS: LandingPlan[] = PLANS.map((p) => ({
  id: p.id,
  name: p.name,
  badge: p.badge,
  price: p.price,
  period: p.period,
  desc: p.description,
  features: p.features,
  href: "/login?mode=signup",
  cta: p.cta,
  theme: p.theme,
  featured: p.featured,
}));
